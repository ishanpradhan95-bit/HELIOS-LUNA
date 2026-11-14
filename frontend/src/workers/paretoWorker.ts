import { calculatePareto } from "../math/pareto";

self.onmessage = () => self.postMessage(calculatePareto());
