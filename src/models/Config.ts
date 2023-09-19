import { ConfigEvent, EventLevel } from "../types";

export interface SlackConfig {
  webhookUrl?: string;
  levels?: {
    [key in EventLevel]?: string;
  };
}

export class Config {
  readonly endpoints: string[];
  readonly validators: string[];
  readonly events: ConfigEvent[];
  /**
   * How much the block speed can differ (ms) from the average before sending a warning
   */
  readonly blockSpeedThreshold: number;
  /**
   * How often to log block speed info, even X blocks
   */
  readonly blockSpeedInfoInterval: number;
  slack?: SlackConfig;

  constructor(env: any) {
    const config = this.parse(env);
    this.endpoints = config.endpoints;
    this.validators = config.validators;
    this.blockSpeedInfoInterval = config.blockSpeedInfoInterval;
    this.blockSpeedThreshold = config.blockSpeedThreshold;
    this.events = config.events;
  }

  private parse(env: any): Config {
    const blockSpeedThreshold = parseInt(env.BLOCK_SPEED_THRESHOLD || "1000");
    const blockSpeedInfoInterval = parseInt(
      env.BLOCK_SPEED_INFO_INTERVAL || "100",
    );
    const endpoints = Config.validateStringArray("ENDPOINTS", env, 1);
    const validators = Config.validateStringArray(
      "VALIDATORS_WATCHLIST",
      env,
      0,
    );
    const events = Config.validateStringArray("EVENTS_WATCHLIST", env, 1).map(
      (event) => {
        if (!(event in ConfigEvent)) {
          console.error(`Available events: ${Object.keys(ConfigEvent)}`);
          throw new Error(`Invalid event: ${event}`);
        }
        return event as ConfigEvent;
      },
    );

    return {
      endpoints,
      validators,
      events,
      blockSpeedThreshold,
      blockSpeedInfoInterval,
    } as Config;
  }

  static validateStringInValues = (
    key: string,
    env: any,
    values: string[],
    required: boolean,
    defaultValue?: string,
  ): string => {
    if (required && (!(key in env) || env[key]!.length === 0)) {
      throw new Error(`Missing required env: ${key}`);
    }

    if (!(key in env) || env[key]!.length === 0) {
      return defaultValue || "";
    }

    const value = env[key]!.trim();
    if (!values.includes(value)) {
      console.error(`Available values: ${values}`);
      throw new Error(`Invalid env: ${key}. Expected one of ${values}`);
    }
    return value;
  };

  static validateStringArray = (
    key: string,
    env: any,
    min: number = 0,
  ): string[] => {
    if (!(key in env) || (env[key]!.length === 0 && min > 0)) {
      throw new Error(`Missing required env: ${key}`);
    }
    const value = env[key]!;
    const items = value.split(",");
    if (items.length < min) {
      throw new Error(
        `Invalid env: ${key}. Expected at least ${min} items, got ${items.length}`,
      );
    }
    return items;
  };

  hasEvent = (event: ConfigEvent): boolean => {
    return this.events.includes(event);
  };

  hasAnyEvent = (events: ConfigEvent[]): boolean => {
    return events.some((event) => this.hasEvent(event));
  };

  toLog = (): object => {
    return {
      endpoints: this.endpoints,
      validators: this.validators,
      events: this.events,
      blockSpeedInfoInterval: this.blockSpeedInfoInterval,
      blockSpeedThreshold: this.blockSpeedThreshold,
    };
  };
}
