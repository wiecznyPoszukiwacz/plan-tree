import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { stderr } from 'node:process';
// SDK oznacza `Server` jako @deprecated z preferencją dla `McpServer`,
// ale sam dokument SDK przyznaje: "Only use Server for advanced use cases".
// Tu używamy raw `setRequestHandler(...)` dla pełnej kontroli nad listą
// resources, które zmieniają się dynamicznie wraz z drzewem — high-level
// McpServer nie ma dla tego dobrego API. Diagnostyka 6385 jest świadoma.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tree, Item } from './types.mjs';
import TreeOperations from './TreeOperations.mjs';

/**
 * Funkcja zwracająca aktualnie wybrany Item w TUI (lub null).
 * Wstrzykiwana z main.mts — MCPServer woła ją przed każdą odpowiedzią,
 * żeby dokleić `selection` do payloadu (ambient context dla agenta).
 */
type SelectionProvider = () => Item | null;

/**
 * MCPServer — serwer Model Context Protocol oparty na @modelcontextprotocol/sdk
 * z transportem Streamable HTTP (spec 2025-03-26). Słucha na localhost,
 * jeden endpoint POST/GET /mcp obsługujący JSON-RPC + opcjonalne SSE.
 */
export default class MCPServer {
  private static readonly SERVER_INSTRUCTIONS = [
    'plan-tree-tui exposes the live in-memory tree of a plan.org file that is currently being edited',
    'in the plan-tree TUI. The tree is a hierarchy of Items (one root, arbitrary depth). Each Item has:',
    'id (string, stable, e.g. "n42"), title (single line), optional TODO keyword (TODO/DONE/QUESTION/',
    'DECISION/RISK/DROPPED), tags, multi-line notes, and children. The format is org-mode: headlines',
    'with stars, :PROPERTIES: drawer holding the :ID:, body text below. The skill plan-tree (separate',
    'from this server) edits the same file by rewriting it; this server gives you structural operations',
    'that mutate the tree in place — the TUI re-renders and autosaves after every tool call.',
    '',
    'Use this server when the user asks to restructure a plan or modify nodes: add/delete/move/split/merge/',
    'extract/absorb subtrees, rename, change TODO state, edit notes, manage tags and properties, reorder',
    'siblings (moveBefore/moveAfter), or search (find). For exploration prefer the lightweight tree://summary',
    'resource (id+title+todo+depth, no notes/properties) over tree://root, which returns the full tree with',
    'all content. tree://item/<id> gives a single-Item subtree as JSON.',
    '',
    'AMBIENT SELECTION: every tool result and every resource response includes a `selection` field describing',
    'the currently focused TUI item: `{id, title, todo, path}` (path is the ID chain from root to selection),',
    'or `null` when nothing is focused. Use this to disambiguate user references like "this", "the current task",',
    '"to co teraz mam zaznaczone" — the user is likely referring to selection.id.',
    '',
    'All tools return JSON in content[0].text',
    'with shape {success, message, itemCount, diff}; check success and message before assuming the',
    'mutation landed. The file on disk is canonical and authoritative — the user can edit it externally.',
  ].join('\n');

  private tree: Tree;
  private readonly onTreeChanged: (newTree: Tree) => void;
  private readonly getSelection: SelectionProvider;
  private readonly port: number;
  private readonly host: string;
  private httpServer: HttpServer | null = null;
  // Per-session: każdy klient MCP (Claude Code, curl, drugi CC w innym oknie)
  // dostaje własną parę Server + transport. Wcześniej był jeden globalny
  // transport — drugi init wywalał się z "Server already initialized",
  // a po rozłączeniu pierwszego klienta cały serwer leciał w "Server not
  // initialized" dla wszystkich.
  private readonly sessions: Map<string, { server: Server; transport: StreamableHTTPServerTransport }> = new Map();

  /**
   * Konstruktor serwera MCP.
   *
   * @param initialTree - Początkowe drzewo
   * @param onChange - Callback wywoływany gdy drzewo się zmieni
   * @param port - Port HTTP na którym słuchać (domyślnie 3000)
   * @param host - Adres bind (domyślnie 127.0.0.1, localhost-only)
   */
  public constructor(
    initialTree: Tree,
    onChange: (newTree: Tree) => void,
    getSelection: SelectionProvider = () => null,
    port: number = 3000,
    host: string = '127.0.0.1',
  ) {
    this.tree = initialTree;
    this.onTreeChanged = onChange;
    this.getSelection = getSelection;
    this.port = port;
    this.host = host;
  }

  /**
   * Zbiera ambient selection do payloadu. Bezpieczne na zniknięcie węzła:
   * jeśli selectedItem ma ID, którego nie ma już w drzewie — zwraca null.
   *
   * @returns Obiekt z id/title/todo/path lub null
   */
  private buildSelectionPayload(): { id: string; title: string; todo: string; path: string[] } | null {
    const sel = this.getSelection();
    if (!sel) return null;
    const id = sel.getId();
    if (!this.tree.itemsById.has(id)) return null;
    const path = this.buildPathToItem(id);
    return { id, title: sel.getTitle(), todo: sel.getTodo(), path };
  }

  /**
   * Buduje listę ID od roota do węzła (włącznie).
   *
   * @param itemId - ID celu
   * @returns Tablica ID; pusty gdy nie znaleziono
   */
  private buildPathToItem(itemId: string): string[] {
    const search = (node: Item, acc: string[]): string[] | null => {
      const next = [...acc, node.getId()];
      if (node.getId() === itemId) return next;
      for (const child of node.getChildren()) {
        const found = search(child, next);
        if (found) return found;
      }
      return null;
    };
    return search(this.tree.root, []) ?? [];
  }

  /**
   * Startuje serwer HTTP. Sesje MCP są tworzone leniwie per request
   * (`handleHttpRequest`), więc tutaj tylko HTTP listener.
   */
  public startServer(): void {
    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });

    this.httpServer.listen(this.port, this.host, () => {
      stderr.write(
        `[MCP] HTTP server listening on http://${this.host}:${this.port}/mcp, items=${this.tree.itemsById.size}\n`,
      );
    });

    this.httpServer.on('error', (error: Error) => {
      stderr.write(`[MCP] HTTP server error: ${error.message}\n`);
    });
  }

  /**
   * Routuje requesty na /mcp do per-session transportów. Jeśli request
   * ma nagłówek `mcp-session-id` i sesję znamy — używamy jej transportu.
   * Inaczej traktujemy jako nową sesję: tworzymy parę Server+transport,
   * rejestrujemy handlery i podpinamy. Sesja zapisuje się do mapy w
   * callbacku `onsessioninitialized`, więc identyfikator jest dostępny
   * dopiero po obsłudze init request'a.
   *
   * @param req - Przychodzący request HTTP
   * @param res - Odpowiedź HTTP
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    if (!url.startsWith('/mcp')) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const sessionIdStr = typeof sessionId === 'string' ? sessionId : undefined;

    let transport: StreamableHTTPServerTransport;
    if (sessionIdStr && this.sessions.has(sessionIdStr)) {
      transport = this.sessions.get(sessionIdStr)!.transport;
    } else {
      transport = this.createSession();
    }

    transport.handleRequest(req, res).catch((error: Error) => {
      stderr.write(`[MCP] handleRequest error: ${error.message}\n`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal error');
      }
    });
  }

  /**
   * Tworzy nową sesję MCP: nowy Server, nowy transport, połączone i
   * zarejestrowane. Transport sam wygeneruje session ID przy `initialize`
   * i wpisze parę do mapy w callbacku `onsessioninitialized`. Po
   * `onclose` (klient odpiął się lub session timeout) wpis znika z mapy.
   *
   * @returns Świeży transport gotowy do `handleRequest`
   */
  private createSession(): StreamableHTTPServerTransport {
    const server = new Server(
      { name: 'plan-tree-tui', version: '0.5.0' },
      {
        capabilities: { tools: {}, resources: {} },
        instructions: MCPServer.SERVER_INSTRUCTIONS,
      },
    );
    this.registerHandlers(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        this.sessions.set(sid, { server, transport });
        stderr.write(`[MCP] Session ${sid.slice(0, 8)} initialized (${this.sessions.size} active)\n`);
      },
    });

    transport.onclose = (): void => {
      const sid = transport.sessionId;
      if (sid && this.sessions.has(sid)) {
        this.sessions.delete(sid);
        stderr.write(`[MCP] Session ${sid.slice(0, 8)} closed (${this.sessions.size} active)\n`);
      }
    };

    server.connect(transport).catch((error: Error) => {
      stderr.write(`[MCP] Failed to connect new session: ${error.message}\n`);
    });

    return transport;
  }

  /**
   * Rejestruje handlery tools/list, tools/call, resources/list, resources/read
   * na obiekcie Server z SDK.
   *
   * @param server - Instancja SDK Server
   */
  private registerHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.runTool(request.params.name, request.params.arguments ?? {});
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.listResources(),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.readResource(request.params.uri);
    });
  }

  /**
   * Zwraca definicje wszystkich tools.
   *
   * @returns Tablica definicji tools (name, description, inputSchema)
   */
  private getToolDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [
      {
        name: 'add',
        description:
          'Add a new Item as the last child of an existing parent. Use this to create fresh nodes — ' +
          'for top-level items pass parentId="root". The new Item gets an auto-generated stable ID that ' +
          'is persisted to the org file as :ID: in the properties drawer (so it survives round-trip). ' +
          'Optional `notes` and `tags` let you set content in a single call.',
        inputSchema: {
          type: 'object',
          properties: {
            parentId: { type: 'string', description: 'ID of the parent. Use "root" for top-level.' },
            title: { type: 'string', description: 'Title (single line). Must not be empty.' },
            todo: {
              type: 'string',
              enum: ['TODO', 'PROPOSAL', 'QUESTION', 'WORK-UNIT', 'DROPPED', 'DONE'],
              description: 'Optional TODO state. Defaults to "TODO".',
            },
            notes: { type: 'string', description: 'Optional notes body.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (no whitespace, no colons).' },
          },
          required: ['parentId', 'title'],
        },
      },
      {
        name: 'setTodo',
        description: 'Change the TODO state of an existing Item without touching title, notes, children, or ID.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of the Item.' },
            todo: { type: 'string', enum: ['TODO', 'PROPOSAL', 'QUESTION', 'WORK-UNIT', 'DROPPED', 'DONE'] },
          },
          required: ['itemId', 'todo'],
        },
      },
      {
        name: 'rename',
        description: 'Change the title of an existing Item. ID, todo, tags, notes, children, properties preserved.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of the Item.' },
            title: { type: 'string', description: 'New title (single line, non-empty).' },
          },
          required: ['itemId', 'title'],
        },
      },
      {
        name: 'setNotes',
        description: 'Replace the notes body of an Item. Pass empty string to clear.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            notes: { type: 'string', description: 'New notes body (may be multi-line, may be empty).' },
          },
          required: ['itemId', 'notes'],
        },
      },
      {
        name: 'addTag',
        description: 'Add a tag to an Item. No-op if tag already present. Tags must not contain whitespace or colons.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            tag: { type: 'string', description: 'Tag string (no whitespace, no ":").' },
          },
          required: ['itemId', 'tag'],
        },
      },
      {
        name: 'removeTag',
        description: 'Remove a tag from an Item. No-op if not present.',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'string' }, tag: { type: 'string' } },
          required: ['itemId', 'tag'],
        },
      },
      {
        name: 'setProperty',
        description: 'Set a custom property in the Item properties drawer. The "ID" key is reserved and cannot be set.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            key: { type: 'string', description: 'Property key (no whitespace, no ":", not "ID").' },
            value: { type: 'string' },
          },
          required: ['itemId', 'key', 'value'],
        },
      },
      {
        name: 'removeProperty',
        description: 'Remove a custom property. The "ID" key is protected.',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'string' }, key: { type: 'string' } },
          required: ['itemId', 'key'],
        },
      },
      {
        name: 'moveBefore',
        description: 'Reorder: move itemId so it sits directly before siblingId among their common parent\'s children. Both must already share a parent (use `move` first if not).',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'string' }, siblingId: { type: 'string' } },
          required: ['itemId', 'siblingId'],
        },
      },
      {
        name: 'moveAfter',
        description: 'Reorder: move itemId so it sits directly after siblingId among their common parent\'s children.',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'string' }, siblingId: { type: 'string' } },
          required: ['itemId', 'siblingId'],
        },
      },
      {
        name: 'getSelection',
        description:
          'Return the currently focused TUI item: {id, title, todo, path} or null. Same data that lands in the `selection` field of every other tool/resource response, but as a standalone read-only query — useful when the user asks "what is selected?" without wanting any mutation.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'freeze',
        description: 'Mark an Item as frozen (paused, not actively worked on). Sets property :FROZEN: t. Distinct from DROPPED (abandoned): frozen items can be resumed. Frozen items are hidden from `find` and `tree://summary` by default — pass includeFrozen=true to see them.',
        inputSchema: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'] },
      },
      {
        name: 'unfreeze',
        description: 'Resume a previously frozen Item. Removes property :FROZEN:.',
        inputSchema: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'] },
      },
      {
        name: 'setPriority',
        description: 'Set or clear the org-mode priority cookie [#A]/[#B]/[#C]. Pass null/empty to clear. [#A]=highest, [#C]=lowest. No priority is the default.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            priority: { type: 'string', enum: ['A', 'B', 'C', ''], description: 'A/B/C or empty string to clear.' },
          },
          required: ['itemId', 'priority'],
        },
      },
      {
        name: 'find',
        description:
          'Search the tree. All filters AND-combined; omit a filter to skip it. Returns the matches as a JSON array in the `diff` field: [{id, title, todo, tags, depth, priority?}]. By default frozen items (with :FROZEN: t) are hidden — pass includeFrozen=true to include them. Use instead of reading tree://root when the tree is large.',
        inputSchema: {
          type: 'object',
          properties: {
            titleContains: { type: 'string', description: 'Case-insensitive substring of title.' },
            todo: { type: 'string', enum: ['TODO', 'PROPOSAL', 'QUESTION', 'WORK-UNIT', 'DROPPED', 'DONE'] },
            tag: { type: 'string', description: 'Exact tag match.' },
            priority: { type: 'string', enum: ['A', 'B', 'C'], description: 'Org-mode priority cookie.' },
            includeFrozen: { type: 'boolean', description: 'Include items with :FROZEN: t. Default false (hidden).' },
          },
        },
      },
      {
        name: 'split',
        description:
          'Split an Item into two siblings at a character offset in its title. The original Item ' +
          'keeps title[0..position) and a new sibling is inserted right after it with title[position..]. ' +
          'Notes and children stay on the original. Use when a headline conflates two distinct ideas ' +
          'that should each become their own work unit. Fails if the Item is root (root has no parent ' +
          'to host the new sibling).',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of Item to split (e.g. "n42"). Must not be root.' },
            position: {
              type: 'number',
              description:
                'UTF-16 code-unit offset within the title where the cut happens. 0 = before first char, ' +
                'title.length = after last char. Must be 0..title.length inclusive.',
            },
          },
          required: ['itemId', 'position'],
        },
      },
      {
        name: 'merge',
        description:
          'Merge two adjacent siblings into one. itemId1 absorbs itemId2: titles are concatenated ' +
          '(itemId1.title + itemId2.title), notes concatenated with newline, children of itemId2 ' +
          'appended to itemId1\'s children. itemId2 is removed from the tree. Use to undo a split or ' +
          'collapse over-fragmented siblings. Both Items must share the same parent.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId1: { type: 'string', description: 'ID of the surviving Item (receives merged content).' },
            itemId2: {
              type: 'string',
              description: 'ID of the Item that gets absorbed and removed. Must be a sibling of itemId1.',
            },
          },
          required: ['itemId1', 'itemId2'],
        },
      },
      {
        name: 'extract',
        description:
          'Remove an Item but keep its children — they get promoted in place to where the Item ' +
          'used to be, becoming siblings of the Item\'s former siblings. Item\'s title and notes are ' +
          'discarded. Use when a node is just a redundant grouping that adds no information beyond ' +
          'its children. Fails on root (root has no parent to promote children to).',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of Item to extract. Must not be root.' },
          },
          required: ['itemId'],
        },
      },
      {
        name: 'absorb',
        description:
          'Inverse of extract: collapse an Item into its parent. The Item\'s title is appended to ' +
          'the parent\'s title (with a space), its notes appended to the parent\'s notes (with newline), ' +
          'and its children become children of the parent at the Item\'s former position. Use when an ' +
          'Item turned out to be a continuation of its parent rather than a real subdivision. Fails on root.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of Item to absorb into its parent. Must not be root.' },
          },
          required: ['itemId'],
        },
      },
      {
        name: 'delete',
        description:
          'Delete an Item together with its entire subtree. All descendants are removed. Use only when ' +
          'the whole branch is genuinely obsolete — for redundant grouping nodes where the children are ' +
          'still wanted, use extract or absorb instead. Refuses to delete root. Irreversible: titles, ' +
          'notes, and structure of all removed nodes are lost.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: {
              type: 'string',
              description:
                'ID of Item to delete. The Item and every descendant under it are removed. Must not be root.',
            },
          },
          required: ['itemId'],
        },
      },
      {
        name: 'move',
        description:
          'Re-parent an Item: detach itemId from its current parent and append it as the last child ' +
          'of targetParentId. The Item keeps its own children, notes, title, ID. Cycle-safe: refuses if ' +
          'targetParentId is itemId itself or any descendant of itemId. Use to reorganize a subtree under ' +
          'a different category. Cannot move root.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: 'ID of Item to move. Must not be root.' },
            targetParentId: {
              type: 'string',
              description:
                'ID of the new parent. Must not be itemId or any descendant of itemId (would create a cycle).',
            },
          },
          required: ['itemId', 'targetParentId'],
        },
      },
    ];
  }

  /**
   * Wykonuje tool, aktualizuje drzewo i wywołuje callback przy sukcesie.
   *
   * @param name - Nazwa toola
   * @param args - Argumenty toola
   * @returns Odpowiedź tools/call w formacie MCP (content[])
   */
  private runTool(name: string, args: Record<string, unknown>): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    let result: { success: boolean; message: string; newTree?: Tree; diff?: unknown };

    try {
      switch (name) {
        case 'split':
          result = TreeOperations.split(this.tree, args.itemId as string, args.position as number);
          break;
        case 'merge':
          result = TreeOperations.merge(this.tree, args.itemId1 as string, args.itemId2 as string);
          break;
        case 'extract':
          result = TreeOperations.extract(this.tree, args.itemId as string);
          break;
        case 'absorb':
          result = TreeOperations.absorb(this.tree, args.itemId as string);
          break;
        case 'move':
          result = TreeOperations.move(this.tree, args.itemId as string, args.targetParentId as string);
          break;
        case 'delete':
          result = TreeOperations.deleteItem(this.tree, args.itemId as string);
          break;
        case 'add':
          result = TreeOperations.add(
            this.tree,
            args.parentId as string,
            args.title as string,
            args.todo as string | undefined,
            args.notes as string | undefined,
            args.tags as string[] | undefined,
          );
          break;
        case 'setTodo':
          result = TreeOperations.setTodo(this.tree, args.itemId as string, args.todo as string);
          break;
        case 'rename':
          result = TreeOperations.rename(this.tree, args.itemId as string, args.title as string);
          break;
        case 'setNotes':
          result = TreeOperations.setNotes(this.tree, args.itemId as string, args.notes as string);
          break;
        case 'addTag':
          result = TreeOperations.addTag(this.tree, args.itemId as string, args.tag as string);
          break;
        case 'removeTag':
          result = TreeOperations.removeTag(this.tree, args.itemId as string, args.tag as string);
          break;
        case 'setProperty':
          result = TreeOperations.setProperty(this.tree, args.itemId as string, args.key as string, args.value as string);
          break;
        case 'removeProperty':
          result = TreeOperations.removeProperty(this.tree, args.itemId as string, args.key as string);
          break;
        case 'moveBefore':
          result = TreeOperations.moveBefore(this.tree, args.itemId as string, args.siblingId as string);
          break;
        case 'moveAfter':
          result = TreeOperations.moveAfter(this.tree, args.itemId as string, args.siblingId as string);
          break;
        case 'find':
          result = TreeOperations.find(this.tree, {
            titleContains: args.titleContains as string | undefined,
            todo: args.todo as string | undefined,
            tag: args.tag as string | undefined,
            priority: args.priority as string | undefined,
            includeFrozen: args.includeFrozen as boolean | undefined,
          });
          break;
        case 'getSelection':
          // No tree mutation — wrap selection in standard envelope.
          result = { success: true, message: 'Current selection', diff: JSON.stringify(this.buildSelectionPayload()) };
          break;
        case 'freeze':
          result = TreeOperations.setProperty(this.tree, args.itemId as string, 'FROZEN', 't');
          break;
        case 'unfreeze':
          result = TreeOperations.removeProperty(this.tree, args.itemId as string, 'FROZEN');
          break;
        case 'setPriority':
          result = TreeOperations.setPriority(this.tree, args.itemId as string, args.priority as string);
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Internal error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    if (result.success && result.newTree) {
      this.tree = result.newTree;
      this.onTreeChanged(this.tree);
    }

    const payload = {
      success: result.success,
      message: result.message,
      itemCount: this.tree.itemsById.size,
      diff: result.diff,
      selection: this.buildSelectionPayload(),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: !result.success,
    };
  }

  /**
   * Lista resources: tree://root + tree://item/<id> dla każdego elementu.
   *
   * @returns Tablica resource descriptors
   */
  private listResources(): Array<{ uri: string; mimeType: string; name: string; description: string }> {
    const resources: Array<{ uri: string; mimeType: string; name: string; description: string }> = [
      {
        uri: 'tree://summary',
        mimeType: 'application/json',
        name: 'Tree summary (lightweight)',
        description:
          'Compact tree overview: array of {id, title, todo, tags, depth} in DFS order. ' +
          'No notes, no properties, no nesting JSON. Use this first to see structure cheaply.',
      },
      {
        uri: 'tree://root',
        mimeType: 'application/json',
        name: 'Whole plan tree (full)',
        description:
          'Full tree as JSON starting from root: {id, title, todo, tags, notes, properties, children[]} ' +
          'recursively. Heavier than tree://summary — use when you need notes or properties.',
      },
    ];
    for (const [itemId, item] of this.tree.itemsById) {
      if (itemId === this.tree.root.getId()) continue;
      const title = item.getTitle();
      const todo = item.getTodo();
      const label = todo ? `${todo} ${title}` : title;
      resources.push({
        uri: `tree://item/${itemId}`,
        mimeType: 'application/json',
        name: `${itemId}: ${label.slice(0, 60)}`,
        description:
          `Single-Item subtree as JSON ({id, title, todo, tags, notes, properties, children[]}). ` +
          `Cheaper than tree://root when you only need this node and its descendants.`,
      });
    }
    return resources;
  }

  /**
   * Czyta resource po URI.
   *
   * @param uri - URI resource'u (tree://root lub tree://item/<id>)
   * @returns Odpowiedź resources/read w formacie MCP
   */
  private readResource(uri: string): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
    if (uri === 'tree://summary') {
      const summary: Array<{ id: string; title: string; todo: string; tags: string[]; depth: number; priority?: 'A' | 'B' | 'C'; frozen?: true }> = [];
      const walk = (node: Tree['root'], depth: number): void => {
        const isFrozen = node.getProperties().get('FROZEN') === 't';
        const entry: typeof summary[number] = {
          id: node.getId(),
          title: node.getTitle(),
          todo: node.getTodo(),
          tags: node.getTags(),
          depth,
        };
        const p = node.getPriority();
        if (p) entry.priority = p;
        if (isFrozen) entry.frozen = true;
        summary.push(entry);
        for (const child of node.getChildren()) walk(child, depth + 1);
      };
      walk(this.tree.root, 0);
      const payload = { selection: this.buildSelectionPayload(), items: summary };
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
      };
    }
    if (uri === 'tree://root') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.itemToJson(this.tree.root), null, 2),
          },
        ],
      };
    }
    if (uri.startsWith('tree://item/')) {
      const itemId = uri.substring('tree://item/'.length);
      const item = this.tree.itemsById.get(itemId);
      if (!item) {
        throw new Error(`Item ${itemId} not found`);
      }
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.itemToJson(item), null, 2),
          },
        ],
      };
    }
    throw new Error(`Unknown resource: ${uri}`);
  }

  /**
   * Konwertuje Item do JSON representation.
   *
   * @param item - Item do konwersji
   * @returns JSON object
   */
  private itemToJson(item: Tree['root']): object {
    return {
      id: item.getId(),
      title: item.getTitle(),
      todo: item.getTodo(),
      tags: item.getTags(),
      notes: item.getNotes(),
      properties: Object.fromEntries(item.getProperties()),
      children: item.getChildren().map((child) => this.itemToJson(child)),
    };
  }

  /**
   * Zamyka transport MCP i serwer HTTP (w tym aktywne strumienie SSE),
   * tak by `handleExit` w main.mts nie zawisł na otwartych połączeniach.
   */
  public stopServer(): void {
    // Zamykamy wszystkie aktywne sesje — każda ma własny transport+server
    for (const { server, transport } of this.sessions.values()) {
      transport.close().catch((error: Error) => {
        stderr.write(`[MCP] transport.close error: ${error.message}\n`);
      });
      server.close().catch((error: Error) => {
        stderr.write(`[MCP] server.close error: ${error.message}\n`);
      });
    }
    this.sessions.clear();

    if (this.httpServer) {
      this.httpServer.closeAllConnections?.();
      this.httpServer.close((error) => {
        if (error) {
          stderr.write(`[MCP] http close error: ${error.message}\n`);
        }
      });
      this.httpServer = null;
      stderr.write(`[MCP] Server stopped\n`);
    }
  }
}
