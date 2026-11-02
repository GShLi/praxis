export interface Observation {
  version: string;
  ranges: Array<[number, number]>;
  length: number;
}
export interface Loaded {
  target: string;
  text: string;
  version: string;
  mode: number;
  nlink: number;
  identity: string;
}
