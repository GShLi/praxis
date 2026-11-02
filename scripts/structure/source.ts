import ts from 'typescript';
export interface Import {
  name: string;
  typeOnly: boolean;
}
export interface SizeFinding {
  key: string;
  lines: number;
  limit: number;
}
export function inspect(file: string, text: string) {
  const lines = text.trimEnd().split('\n').length;
  const sizes: SizeFinding[] = [];
  const fileLimit = file.endsWith('/index.ts') ? 100 : 300;
  if (lines > fileLimit) sizes.push({ key: file, lines, limit: fileLimit });
  const imports: Import[] = [],
    errors: string[] = [];
  if (!/\.tsx?$/.test(file)) return { sizes, imports, errors };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const occurrences = new Map<string, number>();
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? Boolean(node.importClause?.isTypeOnly)
        : node.isTypeOnly;
      imports.push({ name: node.moduleSpecifier.text, typeOnly });
      if (ts.isExportDeclaration(node) && !node.exportClause)
        errors.push(`${file}: 请使用显式导出`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push({ name: node.arguments[0].text, typeOnly: false });
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const length =
        source.getLineAndCharacterOfPosition(node.end).line -
        source.getLineAndCharacterOfPosition(node.getStart(source)).line +
        1;
      const label = functionName(node, source);
      const ordinal = (occurrences.get(label) ?? 0) + 1;
      occurrences.set(label, ordinal);
      if (length > 60) sizes.push({ key: `${file}#${label}:${ordinal}`, lines: length, limit: 60 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (file.endsWith('/index.ts'))
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isEmptyStatement(statement)
      )
        errors.push(`${file}: index.ts 只能导出与声明契约`);
    }
  return { sizes, imports, errors };
}
function functionName(node: ts.SignatureDeclaration, source: ts.SourceFile): string {
  if (node.name) return node.name.getText(source);
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(source);
  if (ts.isCallExpression(node.parent)) {
    const first = node.parent.arguments[0];
    return (
      node.parent.expression.getText(source) +
      (first && ts.isStringLiteral(first) ? `(${first.text})` : ' callback')
    );
  }
  return 'callback';
}
