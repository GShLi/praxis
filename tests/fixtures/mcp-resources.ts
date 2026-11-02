export interface ResourceFixture {
  uri: string;
  title: string;
  text: string;
  binary: boolean;
  loop: boolean;
  paging: boolean;
  beforeRead?: (() => Promise<void>) | undefined;
}
export function resourcesFixture(): ResourceFixture {
  return {
    uri: 'file:///remote/notes.md',
    title: 'Remote notes',
    text: 'Remote resource text',
    binary: false,
    loop: false,
    paging: false,
  };
}
export async function resourceReply(
  fixture: ResourceFixture,
  method: string,
  args: Record<string, unknown>,
) {
  if (method === 'resources/list') {
    const all = [
      { uri: fixture.uri, name: fixture.title },
      { uri: 'https://never-fetch.invalid/other.txt', name: 'Other document' },
    ];
    return {
      resources: fixture.paging ? all.slice(args.cursor ? 1 : 0, args.cursor ? 2 : 1) : all,
      ...(fixture.loop
        ? { nextCursor: 'repeated-cursor' }
        : fixture.paging && !args.cursor
          ? { nextCursor: 'private-server-resource-cursor' }
          : {}),
    };
  }
  if (method === 'resources/templates/list')
    return {
      resourceTemplates: [{ uriTemplate: 'doc://reference/{name}', name: 'Reference page' }],
    };
  if (method === 'resources/read') {
    await fixture.beforeRead?.();
    return {
      contents: [
        {
          uri: args.uri,
          mimeType: fixture.binary ? 'application/octet-stream' : 'text/plain',
          ...(fixture.binary
            ? { blob: 'YmluYXJ5LW11c3Qtbm90LWJlLXByb2plY3RlZA==' }
            : { text: fixture.text }),
        },
      ],
    };
  }
  throw new Error(`Unexpected resource method ${method}`);
}
