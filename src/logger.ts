import { ILogObj, Logger } from "tslog";

const log: Logger<ILogObj> = new Logger({
  name: "monitor",
  type: "pretty",
});

export default log;
