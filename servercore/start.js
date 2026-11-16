// Run ServerCore inside this bot process instead of spawning another Node process.
// This saves one process and several OS threads under KataBump's tight PID limits.
process.env.GOMAXPROCS = process.env.GOMAXPROCS || "1";
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || "2";

require("tsx/cjs");
require("./src/index.ts");
