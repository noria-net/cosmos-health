import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import {
  QueryClient,
  setupAuthExtension,
  setupBankExtension,
  setupStakingExtension,
  setupTxExtension,
} from "@cosmjs/stargate";
import {
  Tendermint34Client,
  Tendermint37Client,
  TendermintClient,
} from "@cosmjs/tendermint-rpc";
import { wait, waitUntilAsync } from "ts-retry";
import { ILogObj, Logger } from "tslog";
import log from "../logger";
import {
  Client,
  ConfigEvent,
  CosmosHealthValidator,
  EventLevel,
  INotifier,
} from "../types";
import { Event } from "./Event";
import { Config } from "./Config";
export default class RpcClient {
  private static TIMEOUT: number = 10_000;
  private static HOLD_TIMEOUT: number = 60_000;
  private errors: number = 0;
  private activeEndpoint: number;
  private client?: Client;
  private log: Logger<ILogObj>;
  private config: Config;
  private tmClient?: TendermintClient;

  private notifiers: INotifier[];
  constructor(env: Config, notifiers: INotifier[]) {
    this.log = log.getSubLogger({ name: "RpcClient" });
    this.config = env;
    this.activeEndpoint = 0;
    this.notifiers = notifiers;
    this.connect();
    this.log.info("New rpcClient");
  }

  critical = (event: ConfigEvent, message: string) => {
    this.notifiers.forEach((n) =>
      n.notify([new Event(event, message, EventLevel.critical)]),
    );
  };

  getClient = () => {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    return this.client;
  };

  rotateEndpoint = () => {
    this.activeEndpoint =
      (this.activeEndpoint + 1) % this.config.endpoints.length;
    this.log.info(
      "Rotating endpoint for rpcClient",
      this.config.endpoints[this.activeEndpoint],
    );
  };

  addConnectionFailure = async () => {
    this.errors++;
    if (this.errors >= this.config.endpoints.length) {
      const msg = `All endpoints failed, trying again in ${Math.floor(
        RpcClient.HOLD_TIMEOUT / 1000,
      )} seconds`;
      this.log.fatal(msg);
      this.critical(ConfigEvent.other, msg);
      await wait(RpcClient.HOLD_TIMEOUT);
      this.errors = 0;
    }
  };

  connect = async () => {
    try {
      await waitUntilAsync(async () => {
        const tm37Client = await Tendermint37Client.connect(
          this.config.endpoints[this.activeEndpoint].replace("/websocket", ""),
        );
        const version = (await tm37Client.status()).nodeInfo.version;
        if (version.startsWith("0.37.")) {
          this.tmClient = tm37Client;
        } else {
          tm37Client.disconnect();
          this.tmClient = await Tendermint34Client.connect(
            this.config.endpoints[this.activeEndpoint].replace(
              "/websocket",
              "",
            ),
          );
        }
        this.client = QueryClient.withExtensions(
          this.tmClient,
          setupAuthExtension,
          setupBankExtension,
          setupStakingExtension,
          setupTxExtension,
        );
        this.log.info(
          "Connected to",
          this.config.endpoints[this.activeEndpoint],
        );
        this.errors = 0;
      }, RpcClient.TIMEOUT);
    } catch (e: any) {
      this.log.error(
        `Error connecting to ${this.config.endpoints[this.activeEndpoint]}: `,
        e.message || "Unknown error",
      );

      await this.addConnectionFailure();
      this.rotateEndpoint();
      this.connect();
    }
  };

  getValidators = async (): Promise<CosmosHealthValidator[]> => {
    const { validators } = await this.client!.staking.validators("");
    return validators.map((val) => {
      /**
       * We create the hex version of the pubkey so we can match validators within block commit signatures list.
       */
      const addr = toHex(
        sha256(new Uint8Array(val.consensusPubkey.value).slice(2)),
      )
        .slice(0, 40)
        .toUpperCase();
      return {
        name: val.description.moniker,
        hexAddress: addr,
        watched: this.config.validators.includes(val.operatorAddress),
        ...val,
      } as CosmosHealthValidator;
    });
  };
}
