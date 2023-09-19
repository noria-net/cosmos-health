import {
  AuthExtension,
  BankExtension,
  QueryClient,
  StakingExtension,
  TxExtension,
} from "@cosmjs/stargate";
import { Validator } from "cosmjs-types/cosmos/staking/v1beta1/staking";
import { Config } from "./models/Config";
import { Event } from "./models/Event";

export enum ConfigEvent {
  other = "other",
  chain = "chain",
  block_speed = "block_speed",
  validator_set = "validator_set",
  signatures = "signatures",
}

export type CosmosHealthValidator = Validator & {
  /**
   * The validator's pubkey in HEX format
   */
  hexAddress: string;

  /**
   * If the validator is being watched from the config file's VALIDATORS_WATCHLIST
   */
  watched: boolean;
};

export type Client = QueryClient &
  AuthExtension &
  BankExtension &
  StakingExtension &
  TxExtension;

export type CosmosHealthBlock = {
  header: {
    time: string;
    height: string;
  };
  last_commit: {
    signatures: {
      signature: string;
      block_id_flag: number;
      timestamp: string;
      validator_address: string;
    }[];
  };
};

export enum EventLevel {
  info = "info",
  warn = "warn",
  critical = "critical",
}

export abstract class INotifier {
  static create: (config: Config) => INotifier;
  notify: (events: Event[]) => Promise<void>;
}
