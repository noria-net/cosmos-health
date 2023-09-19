import { config } from "dotenv";
import { join } from "path";
import Monitor from "./models/Monitor";
import { Config } from "./models/Config";
import log from "./logger";

config({ path: join(__dirname, "..", ".env") });

const env = new Config(process.env);
log.info(env.toLog());

const monitor = new Monitor(env);
monitor.start();

setInterval(() => {}, 1000);
