import { ConfigEvent, EventLevel } from "../types";

export class Event {
  level: EventLevel;
  type: ConfigEvent;
  text: string;
  meta?: object;
  constructor(
    type: ConfigEvent,
    text: string,
    level: EventLevel,
    meta?: object,
  ) {
    this.type = type;
    this.text = text;
    this.level = level;
    this.meta = meta;
  }
}
