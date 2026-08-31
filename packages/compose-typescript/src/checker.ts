import ts from 'typescript'
import { declarationLibrary, declarationLibraryEntry } from './generated/lib'
import { pluginDeclarations } from './declarations'
import type {
  SourceCheckResult,
  SourceChecker,
  SourceDiagnostic,
} from '@tanstack/compose'

/** The source as written, byte for byte, so its lines are the author's lines. */
const pluginFile = '/plugin.ts'
/** The declarations the entry is checked against; see `./declarations`. */
const declarationsFile = '/declarations.d.ts'
/** Asserts the module's shape: default export is a `Setup`, the rest `Handler`s. */
const shapeFile = '/shape.ts'

/**
 * The compilation a written plugin is checked in. `isolatedModules` keeps the
 * check and the transpile in agreement — anything `transpileModule` cannot
 * compile a file at a time is a diagnostic, not a silent miscompile — and
 * `types: []` with the library below is what makes "there is nothing to import
 * and nothing ambient" true.
 */
const compilerOptions: ts.CompilerOptions = {
  allowJs: false,
  alwaysStrict: true,
  isolatedModules: true,
  lib: [declarationLibraryEntry],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noFallthroughCasesInSwitch: true,
  noImplicitOverride: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
}

/** Parsed once and shared by every language service the checker opens. */
const documentRegistry = ts.createDocumentRegistry()

/**
 * Script versions come from here rather than from a per-file counter. The
 * document registry is shared, and it keys a parsed file by path _and version_:
 * two services that both call their source `/plugin.ts` version 1 would be
 * handed each other's syntax tree. A number that only ever goes up means a
 * given path never reuses a version for different text.
 */
let clock = 0

/** How many declaration environments stay warm at once. */
const sessionLimit = 8

interface Session {
  readonly service: ts.LanguageService
  readonly files: Map<string, { text: string; version: number }>
}

/** One named export of the written module, and where it is written. */
interface ExportedName {
  readonly name: string | 'default'
  readonly position: number
}

/**
 * A source checker built on the TypeScript compiler: it type-checks plugin
 * source against the declarations derived from the entry's granted stubs and,
 * when it passes, returns the plain ES module the host starts.
 *
 * Prefer {@link typescriptCheckerPlugin}; this is here for a composer that
 * wants to check source without a client, and for tests.
 *
 * @example
 * ```ts
 * const checker = createTypeScriptChecker()
 * const result = await checker.check({
 *   instanceId: 'draft',
 *   source,
 *   declarations: '',
 *   grants: [{ name: 'tools', declarations: toolsStub.declarations }],
 * })
 * ```
 */
export function createTypeScriptChecker(): SourceChecker {
  const sessions = new Map<string, Session>()

  return {
    check(request): SourceCheckResult {
      const declarations = pluginDeclarations(request.grants)
      const session = sessionFor(sessions, declarations)
      const diagnostics = diagnose(session, request.source)
      if (diagnostics.length > 0) return { diagnostics }
      return { code: transpile(request.source) }
    },
    // The same producer `check` compiles against, so a composer that shows this
    // shows the model exactly what its source is checked against (D8).
    declarations: pluginDeclarations,
  }
}

/** Strip the types. One file, no program: the program already had its say. */
function transpile(source: string): string {
  return ts.transpileModule(source, {
    fileName: pluginFile,
    compilerOptions: { ...compilerOptions, noEmit: false },
  }).outputText
}

/**
 * The language service for one declaration text, opened on first use and kept
 * warm. Declarations are a function of the grant set, so entries with the same
 * grants share one, and an entry whose grants change gets its own.
 */
function sessionFor(
  sessions: Map<string, Session>,
  declarations: string,
): Session {
  const existing = sessions.get(declarations)
  if (existing) {
    // Least-recently-used: re-inserting moves it to the end of the map.
    sessions.delete(declarations)
    sessions.set(declarations, existing)
    return existing
  }

  const files = new Map<string, { text: string; version: number }>([
    [declarationsFile, { text: declarations, version: (clock += 1) }],
    [pluginFile, { text: '', version: (clock += 1) }],
    [shapeFile, { text: '', version: (clock += 1) }],
  ])
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [declarationsFile, pluginFile, shapeFile],
    getScriptVersion: (fileName) => `${files.get(fileName)?.version ?? 0}`,
    getScriptSnapshot: (fileName) => {
      const text = read(files, fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => declarationLibraryEntry,
    fileExists: (fileName) => read(files, fileName) !== undefined,
    readFile: (fileName) => read(files, fileName),
    useCaseSensitiveFileNames: () => true,
    // The only module that resolves is the plugin itself, reached from the
    // shape assertions. Everything else a written plugin might import is
    // unresolved, which is what "there is nothing to import" looks like.
    resolveModuleNameLiterals: (
      literals,
      containingFile,
    ): Array<ts.ResolvedModuleWithFailedLookupLocations> =>
      literals.map((literal) =>
        containingFile === shapeFile && literal.text === './plugin'
          ? {
              resolvedModule: {
                resolvedFileName: pluginFile,
                extension: ts.Extension.Ts,
              },
            }
          : { resolvedModule: undefined },
      ),
  }

  const session: Session = {
    service: ts.createLanguageService(host, documentRegistry),
    files,
  }
  sessions.set(declarations, session)
  if (sessions.size > sessionLimit) {
    const oldest = sessions.keys().next().value
    if (oldest !== undefined) {
      sessions.get(oldest)?.service.dispose()
      sessions.delete(oldest)
    }
  }
  return session
}

/** A file of the session, or one of the shipped declaration library files. */
function read(
  files: Map<string, { text: string; version: number }>,
  fileName: string,
): string | undefined {
  return files.get(fileName)?.text ?? declarationLibrary[fileName]
}

/** Put a file's text in place, bumping its version only when it changed. */
function write(session: Session, fileName: string, text: string): void {
  const file = session.files.get(fileName)!
  if (file.text === text) return
  file.text = text
  file.version = clock += 1
}

/**
 * Everything wrong with this source, ordered by position: TypeScript's own
 * syntactic and semantic diagnostics, the module-shape assertions, and the
 * stubs the source reached for as bare globals.
 */
function diagnose(session: Session, source: string): Array<SourceDiagnostic> {
  write(session, pluginFile, source)
  const parsed = ts.createSourceFile(
    pluginFile,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const exported = exportsOf(parsed)
  const shape = shapeAssertions(exported)
  write(session, shapeFile, shape.text)

  const program = session.service.getProgram()!
  const file = program.getSourceFile(pluginFile)!

  const declarations = session.service.getSyntacticDiagnostics(declarationsFile)
  if (declarations.length > 0) {
    return declarations.map((diagnostic) => ({
      message: `the declarations for this entry are not valid TypeScript: ${message(diagnostic)}`,
    }))
  }

  const own = [
    ...session.service.getSyntacticDiagnostics(pluginFile),
    ...session.service.getSemanticDiagnostics(pluginFile),
  ].map((diagnostic) => ({
    position: diagnostic.start ?? 0,
    message: message(diagnostic),
  }))

  // Anything wrong with the source itself comes first and alone: the shape
  // assertions and the stub-reachability walk are both reasoning about a module
  // TypeScript has already said it does not understand, so their complaints
  // would be noise on top of the real one.
  const extra =
    own.length > 0
      ? []
      : [
          ...session.service.getSemanticDiagnostics(shapeFile).map((one) => ({
            position: shape.positions.get(lineOf(one)) ?? 0,
            message: message(one),
          })),
          ...reachedStubs(program, file),
        ]

  const found = [...own, ...extra]
  found.sort((a, b) => a.position - b.position)
  return found.map(({ position, message: text }) => {
    const at = file.getLineAndCharacterOfPosition(position)
    return { message: text, line: at.line + 1, column: at.character + 1 }
  })
}

/** TypeScript's own sentence, never the code number alone. */
function message(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
}

/** Which line of the shape file a diagnostic landed on. */
function lineOf(diagnostic: ts.Diagnostic): number {
  if (!diagnostic.file || diagnostic.start === undefined) return -1
  return diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
}

/**
 * A module that asserts the written plugin's shape: its default export is a
 * `Setup`, and every other named export is a `Handler`. One assertion per line,
 * so a diagnostic in it maps back to the export it is about.
 */
function shapeAssertions(exported: ReadonlyArray<ExportedName>): {
  text: string
  positions: Map<number, number>
} {
  const lines = [`import * as plugin from './plugin'`]
  const positions = new Map<number, number>()
  const defaultExport = exported.find((one) => one.name === 'default')
  positions.set(lines.length, defaultExport?.position ?? 0)
  lines.push(`const setup: Setup = plugin.default`)
  exported.forEach((one, index) => {
    if (one.name === 'default') return
    positions.set(lines.length, one.position)
    lines.push(
      `const handler${index}: Handler = plugin[${JSON.stringify(one.name)}]`,
    )
  })
  return { text: `${lines.join('\n')}\n`, positions }
}

/** The runtime exports of the written module, and where each is written. */
function exportsOf(file: ts.SourceFile): Array<ExportedName> {
  const found: Array<ExportedName> = []
  const has = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)

  for (const statement of file.statements) {
    const position = statement.getStart(file)
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      found.push({ name: 'default', position })
      continue
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause) continue
      if (!ts.isNamedExports(statement.exportClause)) continue
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue
        found.push({
          name: element.name.text,
          position: element.getStart(file),
        })
      }
      continue
    }
    if (!has(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (has(statement, ts.SyntaxKind.DefaultKeyword)) {
      found.push({ name: 'default', position })
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          found.push({ name: declaration.name.text, position })
        }
      }
      continue
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      found.push({ name: statement.name.text, position })
    }
  }
  return found
}

/**
 * The stubs the source reached for as bare globals. A grant's declaration text
 * is `declare const tools: …`, so `tools` is in scope at compile time — but at
 * run time there is only `stubs.tools`. Resolving through the type checker
 * rather than matching text means a local of the same name is left alone.
 */
function reachedStubs(
  program: ts.Program,
  file: ts.SourceFile,
): Array<{ position: number; message: string }> {
  const checker = program.getTypeChecker()
  const found: Array<{ position: number; message: string }> = []

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValuePosition(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const declaredInDeclarations =
        symbol?.declarations?.some(
          (declaration) =>
            declaration.getSourceFile().fileName === declarationsFile,
        ) === true
      if (
        symbol !== undefined &&
        declaredInDeclarations &&
        (symbol.flags & ts.SymbolFlags.Value) !== 0
      ) {
        found.push({
          position: node.getStart(file),
          message: `"${node.text}" is a stub: reach it through the setup argument, as stubs.${node.text}`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Whether this identifier is a use of a value rather than a property name. */
function isValuePosition(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isPropertySignature(parent) && parent.name === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  return true
}
