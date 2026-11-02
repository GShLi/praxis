import { JsonLines } from '@praxis/transport';
import { HostProcess } from './host-process.ts';
function main() {
  new HostProcess(new JsonLines(process.stdin, process.stdout)).start();
}
main();
