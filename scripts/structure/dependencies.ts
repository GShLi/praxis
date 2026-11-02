import { existsSync } from 'node:fs';
import path from 'node:path';
import { owner, type Package } from './project.ts';
import type { Import } from './source.ts';
export function dependencies(
  file: string,
  imports: Import[],
  workspace: Package[],
  errors: string[],
) {
  const edges: string[] = [],
    runtime: string[] = [];
  const current = owner(file, workspace);
  for (const specifier of imports) {
    const name = specifier.name;
    let target: string | undefined;
    if (name.startsWith('.')) {
      target = path.normalize(path.join(path.dirname(file), name));
      if (owner(target, workspace) !== current) errors.push(`${file}: 跨包相对导入 ${name}`);
      if (name.endsWith('/index.ts') && owner(target, workspace) === current)
        errors.push(`${file}: 内部反向导入入口 ${name}`);
      if (!existsSync(target)) errors.push(`${file}: 导入目标不存在 ${name}`);
    } else if (!name.startsWith('node:')) {
      const packageName = name.startsWith('@')
        ? name.split('/').slice(0, 2).join('/')
        : name.split('/')[0]!;
      const declared = { ...current.manifest.dependencies, ...current.manifest.devDependencies };
      if (!declared[packageName]) errors.push(`${file}: 未声明依赖 ${packageName}`);
      const dependency = workspace.find((item) => item.manifest.name === packageName);
      if (dependency) {
        if (dependency === current) errors.push(`${file}: 内部通过包入口导入自身 ${name}`);
        const subpath = name === packageName ? '.' : '.' + name.slice(packageName.length);
        const exported = dependency.manifest.exports?.[subpath];
        if (!exported) errors.push(`${file}: 非公开导出 ${name}`);
        else {
          target = path.join(dependency.directory, exported);
          if (!existsSync(target)) errors.push(`${file}: 导出目标不存在 ${name}`);
        }
      }
    }
    if (target) {
      edges.push(target);
      if (!specifier.typeOnly) runtime.push(target);
    }
    if (
      !specifier.typeOnly &&
      (file.startsWith('packages/ui/') || file.startsWith('apps/web/src/')) &&
      name.startsWith('node:')
    )
      errors.push(`${file}: 浏览器源码依赖 Node ${name}`);
  }
  return { edges, runtime };
}
export function cycles(graph: Map<string, string[]>, errors: string[]) {
  const done = new Set<string>(),
    active = new Set<string>(),
    route: string[] = [];
  function visit(file: string) {
    if (active.has(file)) {
      errors.push(`依赖环: ${[...route.slice(route.indexOf(file)), file].join(' → ')}`);
      return;
    }
    if (done.has(file)) return;
    active.add(file);
    route.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    route.pop();
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file);
}
