import { readFileSync } from 'node:fs';
import { dependencies, cycles } from './structure/dependencies.ts';
import { packages, sourceFiles } from './structure/project.ts';
import { inspect, type SizeFinding } from './structure/source.ts';
interface Review {
  maxLines: number;
  reason: string;
  validation: string;
}
function main() {
  const workspace = packages(),
    errors: string[] = [],
    sizes: SizeFinding[] = [];
  const graph = new Map<string, string[]>();
  const files = sourceFiles();
  for (const file of files) {
    const result = inspect(file, readFileSync(file, 'utf8'));
    errors.push(...result.errors);
    sizes.push(...result.sizes);
    graph.set(file, dependencies(file, result.imports, workspace, errors).edges);
  }
  cycles(graph, errors);
  if (process.argv.includes('--report')) {
    console.log(JSON.stringify({ files: files.length, sizes, errors }, null, 2));
    return;
  }
  const reviews = JSON.parse(readFileSync('docs/structure-exceptions.json', 'utf8')) as Record<
    string,
    Review
  >;
  for (const finding of sizes) {
    const review = reviews[finding.key];
    if (!review || !review.reason || !review.validation || finding.lines > review.maxLines)
      errors.push(
        `${finding.key}: ${finding.lines} 行，超过 ${finding.limit} 行评审阈值，需要拆分或更新具体审查记录`,
      );
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `结构检查通过：${files.length} 个源码/样式/原生文件；${sizes.length} 项规模例外均有范围和验证依据。`,
    );
}
main();
