import log from "../logger";
import { ILogObj, Logger } from "tslog";
import { WebSocket } from "ws";
import { wait } from "ts-retry";
import { Config } from "./Config";
import {
  ConfigEvent,
  CosmosHealthBlock,
  EventLevel,
  INotifier,
} from "../types";
import { Event } from "./Event";
export default class WSClient {
  private static TIMEOUT: number = 10_000;
  private static HOLD_TIMEOUT: number = 60_000;
  private errors: number = 0;
  private previousBlock: CosmosHealthBlock | undefined;
  private blockMonitorId: NodeJS.Timeout | undefined;
  endpoints: string[];
  activeEndpoint: number;
  private log: Logger<ILogObj>;
  client?: WebSocket;
  private notifiers: INotifier[];
  private onNewBlock: (block: CosmosHealthBlock) => void;
  constructor(env: Config, notifiers: INotifier[]) {
    this.log = log.getSubLogger({ name: "WSClient" });
    this.notifiers = notifiers;
    this.endpoints = env.endpoints;
    this.activeEndpoint = 0;
    this.onNewBlock = (block: CosmosHealthBlock) => {};
  }

  critical = (event: ConfigEvent, message: string) => {
    this.notifiers.forEach((n) =>
      n.notify([new Event(event, message, EventLevel.critical)]),
    );
  };

  /**
   * Set the callback to be called when a new block is received
   *
   * @param (block: Block) => void
   */
  setNewBlockListener = (onNewBlock: (block: CosmosHealthBlock) => void) => {
    this.onNewBlock = onNewBlock;
  };

  /**
   * If all endpoints fail, wait for a minute before trying again
   */
  addConnectionFailure = async () => {
    this.errors++;
    if (this.errors >= this.endpoints.length) {
      const msg = `All endpoints failed, trying again in ${Math.floor(
        WSClient.HOLD_TIMEOUT / 1000,
      )} seconds`;
      this.log.fatal(msg);
      this.stopMonitoringBlockGeneration();
      this.critical(ConfigEvent.other, msg);
      await wait(WSClient.HOLD_TIMEOUT);
      this.errors = 0;
    }
  };

  rotateEndpoint = () => {
    this.activeEndpoint = (this.activeEndpoint + 1) % this.endpoints.length;
    this.log.info(
      "Rotating endpoint for wsClient",
      this.endpoints[this.activeEndpoint],
    );
  };

  onOpen = () => {
    this.log.info(
      "WebSocket Client Connected",
      this.endpoints[this.activeEndpoint],
    );

    this.startMonitoringBlockGeneration();

    setTimeout(() => {
      this.client!.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "subscribe",
          params: { query: "tm.event='NewBlock'" },
        }),
      );
    }, 1000);
  };

  onClose = async (e: any) => {
    this.log.info("Connection Closed", e);
    this.rotateEndpoint();
    await this.addConnectionFailure();
    setTimeout(() => this.init(), 3000);
  };

  onError = (e: any) => {
    this.log.error("Connection Error", e);
  };

  onMessage = (message: any) => {
    console.log(`Received message`);
    const payload = JSON.parse(message.toString());
    if (!payload.result || !payload.result.data) {
      return;
    }
    const block = payload.result.data.value.block as CosmosHealthBlock;
    this.log.info("New block");
    this.previousBlock = block;
    this.onNewBlock(block);
  };

  startMonitoringBlockGeneration = () => {
    this.log.info("Starting monitoring block generation");
    this.blockMonitorId = setInterval(() => {
      if (!this.previousBlock) {
        return;
      }
      const deltaInMs =
        Date.now() - new Date(this.previousBlock.header.time).getTime();
      if (deltaInMs > 1000 * 30) {
        const msg = `No block in the last ${Math.floor(deltaInMs / 1000)}s`;
        this.log.fatal(msg);
        this.critical(ConfigEvent.chain, msg);
      }
    }, 30000);
  };

  stopMonitoringBlockGeneration = () => {
    this.log.info("Stopping monitoring block generation");
    if (this.blockMonitorId) {
      clearInterval(this.blockMonitorId);
    }
  };

  init = () => {
    this.connect();
    this.client.on("error", (e) => this.onError(e));
    this.client.on("close", (e) => this.onClose(e));
    this.client.on("message", (msg) => this.onMessage(msg));
    this.client.on("open", () => this.onOpen());
  };

  connect = () => {
    this.log.info("Connecting...", this.endpoints[this.activeEndpoint]);
    this.client = new WebSocket(this.endpoints[this.activeEndpoint], {
      handshakeTimeout: WSClient.TIMEOUT,
    });
  };
}
