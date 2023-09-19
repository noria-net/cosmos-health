import EventParser from "./EventParser";
import log from "../logger";
import { INotifier } from "../types";
import { Config } from "./Config";
import RpcClient from "./RpcClient";
import WSClient from "./WsClient";
import SlackNotifier from "./notifiers/SlackNotifier";
export default class Monitor {
  private config: Config;
  private wsClient: WSClient;
  private notifiers: INotifier[];
  private rpcClient: RpcClient;
  private eventParser: EventParser;

  constructor(config: Config) {
    log.info("New monitor");
    this.config = config;
    this.notifiers = [SlackNotifier.create(this.config)];
    this.rpcClient = new RpcClient(config, this.notifiers);
    this.wsClient = new WSClient(config, this.notifiers);
    this.eventParser = new EventParser(config, this.rpcClient, this.notifiers);
    this.wsClient.setNewBlockListener(this.eventParser.parseBlock);
  }

  start = () => {
    log.info("Starting monitor");
    this.wsClient.init();
  };
}
