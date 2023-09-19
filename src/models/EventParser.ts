import { Logger, ILogObj } from "tslog";
import log from "../logger";
import {
  ConfigEvent,
  CosmosHealthBlock,
  CosmosHealthValidator,
  EventLevel,
  INotifier,
} from "../types";
import RpcClient from "./RpcClient";
import { Event } from "./Event";
import { BondStatus } from "cosmjs-types/cosmos/staking/v1beta1/staking";
import { Config } from "./Config";

export default class EventParser {
  config: Config;
  private log: Logger<ILogObj>;
  private client: RpcClient;
  private events: Set<string> = new Set<string>();
  /**
   * Events that should not be dispatched again
   */
  private backlistedEvents: Set<string> = new Set<string>();
  private previousBlock: CosmosHealthBlock | undefined;
  private averageBlockSpeed: number = 0;
  private blockTracked: number = 0;
  private previousValidators: CosmosHealthValidator[] = [];
  private notifiers: INotifier[];

  constructor(config: Config, client: RpcClient, notifiers: INotifier[]) {
    this.log = log.getSubLogger({ name: "EventParser" });
    this.client = client;
    this.config = config;
    this.notifiers = notifiers;
  }

  parseBlock = async (block: CosmosHealthBlock) => {
    this.log.info("Parsing block", block.header.height);
    // this.log.debug(block);

    if (this.config.hasEvent(ConfigEvent.block_speed)) {
      this.checkBlockSpeed(block);
    }

    if (
      this.config.hasAnyEvent([
        ConfigEvent.validator_set,
        ConfigEvent.signatures,
      ])
    ) {
      const validators = await this.client.getValidators();
      this.checkValidatorSet(validators);
      await this.parseForMissingValidators(block, validators);
    }

    this.dispatchEvents(this.getEvents());
    this.events.clear();
  };

  private checkValidatorSet = (validators: CosmosHealthValidator[]) => {
    if (
      !this.config.hasEvent(ConfigEvent.validator_set) ||
      this.previousValidators.length === 0
    ) {
      this.previousValidators = validators;
      return;
    }
    const delta = validators.length - this.previousValidators.length;
    if (delta > 0) {
      // get newly added validators
      const newValidators = validators.filter(
        (v) =>
          !this.previousValidators.find(
            (pv) => pv.operatorAddress === v.operatorAddress,
          ),
      );
      if (newValidators.length > 0) {
        this.addEvent(
          new Event(
            ConfigEvent.validator_set,
            newValidators
              .map((v) => {
                return `New validator added: ${
                  v.description?.moniker || v.operatorAddress
                }`;
              })
              .join("\n"),
            EventLevel.info,
          ),
        );
      }
    }
    const newlyBondedValidators = validators.filter((v) => {
      const prev = this.previousValidators.find(
        (pv) => pv.operatorAddress === v.operatorAddress,
      );
      if (!prev) return false;
      return (
        v.status === BondStatus.BOND_STATUS_BONDED && prev.status !== v.status
      );
    });
    if (newlyBondedValidators.length > 0) {
      this.addEvent(
        new Event(
          ConfigEvent.validator_set,
          newlyBondedValidators
            .map((v) => {
              return `New validator bonded: ${
                v.description?.moniker || v.operatorAddress
              }`;
            })
            .join("\n"),
          EventLevel.info,
        ),
      );
    }

    const newlyUnbondedValidators = validators.filter((v) => {
      const prev = this.previousValidators.find(
        (pv) => pv.operatorAddress === v.operatorAddress,
      );
      if (!prev) return false;
      return (
        v.status !== BondStatus.BOND_STATUS_BONDED &&
        prev.status === BondStatus.BOND_STATUS_BONDED
      );
    });
    if (newlyUnbondedValidators.length > 0) {
      this.addEvent(
        new Event(
          ConfigEvent.validator_set,
          newlyUnbondedValidators
            .map((v) => {
              return `Validator unbonded: ${
                v.description?.moniker || v.operatorAddress
              }`;
            })
            .join("\n"),
          EventLevel.warn,
        ),
      );
    }
    this.previousValidators = validators;
  };

  private checkBlockSpeed(block: CosmosHealthBlock) {
    if (!this.previousBlock) {
      this.previousBlock = block;
      this.blockTracked = 1;
      this.log.debug("first block tracked");
      return;
    }
    const deltaInMs =
      new Date(block.header.time).getTime() -
      new Date(this.previousBlock.header.time).getTime();
    if (this.averageBlockSpeed === 0) {
      this.previousBlock = block;
      this.averageBlockSpeed = deltaInMs;
      this.blockTracked++;
      this.log.debug("first 2 blocks tracked");
      return;
    }

    if (
      parseInt(block.header.height) % this.config.blockSpeedInfoInterval ===
      0
    ) {
      this.addEvent(
        new Event(
          ConfigEvent.block_speed,
          `Block ${block.header.height} speed: ${(deltaInMs / 1000).toFixed(
            2,
          )}s, average: ${(this.averageBlockSpeed / 1000).toFixed(2)}s`,
          EventLevel.info,
        ),
      );
    }

    if (
      Math.abs(deltaInMs - this.averageBlockSpeed) >
      this.config.blockSpeedThreshold
    ) {
      this.addEvent(
        new Event(
          ConfigEvent.block_speed,
          `Block speed is ${(deltaInMs / 1000).toFixed(2)}s, average is ${(
            this.averageBlockSpeed / 1000
          ).toFixed(2)}s`,
          EventLevel.warn,
        ),
      );
    }
    this.previousBlock = block;
    this.averageBlockSpeed =
      (this.averageBlockSpeed * this.blockTracked + deltaInMs) /
      ++this.blockTracked;
  }

  private dispatchEvents = (events: Event[]) => {
    this.notifiers.forEach((n) => n.notify(events));
  };

  private addEvent = (event: Event, blacklist: boolean = false) => {
    if (blacklist && this.backlistedEvents.has(JSON.stringify(event))) return;
    this.events.add(JSON.stringify(event));
    this.log.debug(event);
    if (blacklist) this.backlistedEvents.add(JSON.stringify(event));
  };

  private getEvents = (): Event[] => {
    const events = Array.from(this.events);
    return events.map((event) => JSON.parse(event));
  };

  parseForMissingValidators = async (
    block: CosmosHealthBlock,
    validators: CosmosHealthValidator[],
  ) => {
    if (
      !(
        this.config.hasEvent(ConfigEvent.signatures) ||
        this.config.hasEvent(ConfigEvent.validator_set)
      ) ||
      this.config.validators.length === 0
    )
      return;

    const unbondedWatchedValidators = validators.filter((v) => {
      return v.watched && v.status !== BondStatus.BOND_STATUS_BONDED;
    });

    for (const v of unbondedWatchedValidators) {
      this.addEvent(
        new Event(
          ConfigEvent.validator_set,
          `Watched validator "${v.description?.moniker}" is unbonded, blacklisting event`,
          EventLevel.warn,
          {
            operatorAddress: v.operatorAddress,
          },
        ),
        true,
      );
    }

    const missedSignatures = block.last_commit.signatures.filter(
      (signature) => signature.block_id_flag !== 2,
    );
    const missedValidators = missedSignatures
      .map((signature) =>
        validators.find(
          (validator) => validator.hexAddress === signature.validator_address,
        ),
      )
      .filter((v) => v);

    if (missedValidators.length === 0) return;

    this.addEvent(
      new Event(
        ConfigEvent.signatures,
        `Found ${missedSignatures.length} missing signatures in block ${block.header.height}`,
        EventLevel.info,
        {
          validators: missedValidators.map((v) => v.description?.moniker),
        },
      ),
    );

    const missingWatchedValidators = missedValidators.filter((v) => v.watched);

    if (missingWatchedValidators.length === 0) return;

    this.addEvent(
      new Event(
        ConfigEvent.signatures,
        `Found ${missingWatchedValidators.length} missing signatures from watched validators in block ${block.header.height}`,
        EventLevel.warn,
        {
          validators: missingWatchedValidators.map(
            (v) => v.description?.moniker,
          ),
        },
      ),
    );
  };
}
