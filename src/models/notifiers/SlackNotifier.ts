import axios, { Axios } from "axios";
import { ConfigEvent, EventLevel, INotifier } from "../../types";
import { ILogObj, Logger } from "tslog";
import log from "../../logger";
import { Config } from "../Config";
import { Event } from "../Event";

export default class SlackNotifier extends INotifier {
  private log: Logger<ILogObj>;
  private config: Config;
  private api: Axios;

  private constructor() {
    super();
  }
  static create = (config: Config) => {
    const self = new SlackNotifier();
    self.log = log.getSubLogger({ name: "Slack Notifier" });

    self.config = config;
    self.parseEnv(process.env);
    self.api = axios.create({
      headers: {
        "Content-type": "application/json",
      },
    });

    return self;
  };

  private parseEnv = (env: any) => {
    const webhookUrl = env.SLACK_WEBHOOK_URL;
    const info = env.SLACK_INFO;
    const warn = env.SLACK_WARN;
    const critical = env.SLACK_CRITICAL;

    if (!webhookUrl && !info && !warn && !critical) {
      this.logUsageMessage();
      throw new Error("Slack config is not set");
    }

    this.config.slack = {
      webhookUrl,
      levels: {
        [EventLevel.info]: info,
        [EventLevel.warn]: warn,
        [EventLevel.critical]: critical,
      },
    };

    if (!info && !warn && !critical) {
      this.config.slack.levels[EventLevel.info] = webhookUrl;
      this.config.slack.levels[EventLevel.warn] = webhookUrl;
      this.config.slack.levels[EventLevel.critical] = webhookUrl;
    }

    this.log.info("Slack config has been set");
  };
  private logUsageMessage = (): void => {
    this.log.info(`Usage:

    # Slack webhook url. If no INFO, WARN or CRITICAL set, all events will be sent to this url
    SLACK_WEBHOOK_URL: string

    # Slack webhook url for INFO events
    SLACK_INFO: string
    
    # Slack webhook url for WARN events
    SLACK_WARN: string

    # Slack webhook url for CRITICAL events
    SLACK_CRITICAL: string

    `);
  };

  send = async (level: string, events: Event[]) => {
    this.log.debug("Sending slack message");
    try {
      const res = await this.api.post(this.config.slack.levels[level], {
        text: events
          .map((event) =>
            event.meta
              ? `${event.text}\n${JSON.stringify(event.meta, null, 2)}`
              : event.text,
          )
          .join("\n\n"),
      });
      if (res.status >= 300) {
        this.log.error("Slack response", res);
      }
    } catch (e) {
      this.log.error("Slack error", e.message);
    }
  };

  notify = async (events: Event[]) => {
    const groupedEvents: { [key in EventLevel]: Event[] } = events.reduce(
      (acc: any, event: Event) => {
        if (!this.config.slack.levels[event.level]) return acc;
        if (!(event.level in acc)) {
          acc[event.level] = [];
        }
        acc[event.level].push(event);
        return acc;
      },
      {},
    );

    Object.keys(groupedEvents).forEach((level) => {
      const events = groupedEvents[level];
      this.send(level, events);
    });
  };

  critical = async (message: string) => {
    if (!this.config.slack.levels[EventLevel.critical]) {
      this.log.warn("No slack webhook url set for critical events");
      return;
    }
    this.send(EventLevel.critical, [
      new Event(ConfigEvent.other, message, EventLevel.critical),
    ]);
  };
}
