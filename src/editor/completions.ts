import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import {
  completeAnyWord,
  completeFromList,
  snippetCompletion,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete'

/**
 * Per-language completion extras, attached to the editor alongside the
 * language extension (see langs.ts). Two layers:
 *
 *  - keyword/snippet lists for languages that ship no completions of their
 *    own (all legacy StreamLanguage grammars, plus go/rust/c/cpp/java/php);
 *  - `completeAnyWord` as a document-wide fallback for those same languages,
 *    so every code file completes identifiers from its own text.
 *
 * Languages with native completion sources (js/ts/py/css/html/json/sql/vue)
 * are deliberately left out of the fallback set — word completion there
 * would only duplicate what the language package already offers. Prose
 * formats (md) are excluded too: popping suggestions mid-sentence is noise.
 */

const kw = (...labels: string[]): Completion[] => labels.map((label) => ({ label, type: 'keyword' }))
const fns = (...labels: string[]): Completion[] => labels.map((label) => ({ label, type: 'function' }))
const types = (...labels: string[]): Completion[] => labels.map((label) => ({ label, type: 'type' }))

/** `${}` marks the final cursor stop; `\n\t` expands to newline + one indent
 * unit, re-indented to the line the snippet lands on. */
const snip = (label: string, template: string, detail: string): Completion =>
  snippetCompletion(template, { label, detail, type: 'snippet', boost: 1 })

const JS_SNIPPETS: Completion[] = [
  snip('log', 'console.log(${})', 'console.log'),
  snip('warn', 'console.warn(${})', 'console.warn'),
  snip('error', 'console.error(${})', 'console.error'),
  snip('fn', 'function ${name}(${params}) {\n\t${}\n}', 'function'),
  snip('afn', 'const ${name} = (${params}) => {\n\t${}\n}', 'arrow function'),
  snip('for', 'for (let ${i} = 0; ${i} < ${n}.length; ${i}++) {\n\t${}\n}', 'for loop'),
  snip('forof', 'for (const ${item} of ${list}) {\n\t${}\n}', 'for-of loop'),
  snip('if', 'if (${cond}) {\n\t${}\n}', 'if'),
  snip('ifelse', 'if (${cond}) {\n\t${}\n} else {\n\t${}\n}', 'if/else'),
  snip('tryc', 'try {\n\t${}\n} catch (${err}) {\n\t${}\n}', 'try/catch'),
  snip('class', 'class ${Name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}', 'class'),
  snip('imp', "import ${name} from '${module}'${}", 'import'),
]

const PY_SNIPPETS: Completion[] = [
  snip('def', 'def ${name}(${params}):\n\t${}', 'function'),
  snip('class', 'class ${Name}:\n\t${}', 'class'),
  snip('main', "if __name__ == '__main__':\n\t${}", 'main guard'),
  snip('for', 'for ${item} in ${items}:\n\t${}', 'for loop'),
  snip('while', 'while ${cond}:\n\t${}', 'while loop'),
  snip('with', 'with open(${file}) as ${f}:\n\t${}', 'with open'),
  snip('trye', 'try:\n\t${}\nexcept ${Exception} as ${e}:\n\t${}', 'try/except'),
  snip('imp', 'import ${module}${}', 'import'),
]

const GO_SNIPPETS: Completion[] = [
  snip('func', 'func ${name}(${params}) {\n\t${}\n}', 'function'),
  snip('funcm', 'func main() {\n\t${}\n}', 'func main'),
  snip('iferr', 'if err != nil {\n\t${}\n}', 'if err != nil'),
  snip('forr', 'for ${i}, ${v} := range ${items} {\n\t${}\n}', 'for-range'),
  snip('struct', 'type ${Name} struct {\n\t${}\n}', 'struct type'),
  snip('printf', 'fmt.Printf("${}\n", ${v})', 'fmt.Printf'),
]

const RUST_SNIPPETS: Completion[] = [
  snip('fn', 'fn ${name}(${params}) {\n\t${}\n}', 'function'),
  snip('main', 'fn main() {\n\t${}\n}', 'fn main'),
  snip('iflet', 'if let ${pattern} = ${expr} {\n\t${}\n}', 'if let'),
  snip('match', 'match ${expr} {\n\t${}\n}', 'match'),
  snip('impl', 'impl ${Type} {\n\t${}\n}', 'impl block'),
  snip('test', '#[test]\nfn ${name}() {\n\t${}\n}', 'unit test'),
  snip('pln', 'println!("${}");', 'println!'),
]

const JAVA_SNIPPETS: Completion[] = [
  snip('main', 'public static void main(String[] args) {\n\t${}\n}', 'main method'),
  snip('sysout', 'System.out.println(${});', 'System.out.println'),
  snip('class', 'public class ${Name} {\n\t${}\n}', 'class'),
]

const C_SNIPPETS: Completion[] = [
  snip('main', 'int main(int argc, char *argv[]) {\n\t${}\n\treturn 0;\n}', 'main function'),
  snip('inc', '#include "${}"', '#include "…"'),
  snip('incs', '#include <${}>', '#include <…>'),
]

const KEYWORDS: Record<string, Completion[]> = {
  sh: kw(
    'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
    'function', 'in', 'select', 'return', 'exit', 'local', 'export', 'readonly', 'unset', 'shift',
    'source', 'alias', 'echo', 'printf', 'cd', 'pwd', 'true', 'false', 'set', 'trap', 'eval',
    'exec', 'declare', 'test', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'awk', 'sed', 'cat', 'chmod',
    'curl', 'wget', 'tar', 'find', 'xargs', 'git',
  ),
  ps1: kw(
    'if', 'else', 'elseif', 'switch', 'foreach', 'for', 'while', 'do', 'until', 'break',
    'continue', 'function', 'return', 'throw', 'try', 'catch', 'finally', 'param', 'begin',
    'process', 'end', 'filter', 'class', 'enum', 'in', 'trap',
  ),
  rb: kw(
    'def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for',
    'in', 'do', 'then', 'begin', 'rescue', 'ensure', 'raise', 'retry', 'yield', 'return', 'break',
    'next', 'redo', 'self', 'nil', 'true', 'false', 'and', 'or', 'not', 'require',
    'require_relative', 'include', 'extend', 'attr_accessor', 'attr_reader', 'attr_writer',
    'puts', 'print', 'lambda', 'proc', 'new', 'case', 'when', 'catch', 'throw', 'loop',
  ),
  lua: kw(
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if',
    'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
  ),
  r: kw(
    'if', 'else', 'for', 'while', 'repeat', 'break', 'next', 'return', 'function', 'switch',
    'in', 'TRUE', 'FALSE', 'NULL', 'NA', 'NaN', 'Inf', 'library', 'require', 'source',
  ),
  dockerfile: kw(
    'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME',
    'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'AS',
  ),
  cmake: kw(
    'cmake_minimum_required', 'project', 'set', 'unset', 'list', 'message', 'include',
    'include_directories', 'add_executable', 'add_library', 'add_subdirectory',
    'add_custom_command', 'add_custom_target', 'add_definitions', 'target_link_libraries',
    'target_include_directories', 'target_compile_definitions', 'option', 'if', 'elseif',
    'else', 'endif', 'foreach', 'endforeach', 'while', 'endwhile', 'function', 'endfunction',
    'macro', 'endmacro', 'find_package', 'find_library', 'find_path', 'find_program',
    'install', 'export', 'configure_file', 'file', 'string', 'math',
  ),
  cs: kw(
    'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked',
    'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else',
    'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for',
    'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock',
    'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
    'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
    'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true',
    'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'var',
    'virtual', 'void', 'volatile', 'while', 'async', 'await', 'get', 'set', 'value',
  ),
  kt: kw(
    'abstract', 'actual', 'annotation', 'as', 'break', 'by', 'catch', 'class', 'companion',
    'const', 'constructor', 'continue', 'crossinline', 'data', 'do', 'dynamic', 'else', 'enum',
    'expect', 'external', 'false', 'final', 'finally', 'for', 'fun', 'get', 'if', 'import',
    'in', 'infix', 'init', 'inline', 'inner', 'interface', 'internal', 'is', 'lateinit',
    'lazy', 'null', 'object', 'open', 'operator', 'out', 'override', 'package', 'private',
    'protected', 'public', 'reified', 'return', 'sealed', 'set', 'super', 'suspend', 'this',
    'throw', 'true', 'try', 'typealias', 'val', 'var', 'vararg', 'when', 'where', 'while',
  ),
  dart: kw(
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
    'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
    'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'get',
    'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library', 'mixin', 'new',
    'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set', 'show', 'static',
    'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var', 'void',
    'while', 'with', 'yield',
  ),
  swift: kw(
    'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import',
    'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public',
    'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue',
    'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat',
    'return', 'switch', 'where', 'while', 'as', 'Any', 'catch', 'false', 'is', 'nil',
    'rethrows', 'super', 'self', 'throw', 'throws', 'true', 'try',
  ),
  pl: kw(
    'my', 'our', 'local', 'sub', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for',
    'foreach', 'do', 'last', 'next', 'redo', 'return', 'use', 'no', 'require', 'package',
    'bless', 'ref', 'defined', 'undef', 'exists', 'delete', 'keys', 'values', 'each', 'print',
    'printf', 'sprintf', 'chomp', 'chop', 'split', 'join', 'push', 'pop', 'shift', 'unshift',
    'sort', 'reverse', 'map', 'grep', 'scalar',
  ),
  erl: kw(
    'module', 'export', 'import', 'if', 'case', 'of', 'end', 'when', 'begin', 'try', 'catch',
    'after', 'receive', 'fun', 'let', 'query', 'cond', 'and', 'or', 'xor', 'not', 'true',
    'false', 'ok', 'error', 'throw', 'spawn', 'spawn_link', 'send', 'self', 'apply',
  ),
  hs: kw(
    'case', 'of', 'data', 'type', 'newtype', 'deriving', 'instance', 'class', 'where', 'let',
    'in', 'do', 'module', 'import', 'qualified', 'as', 'hiding', 'if', 'then', 'else', 'infix',
    'infixl', 'infixr', 'return',
  ),
  ml: kw(
    'let', 'in', 'if', 'then', 'else', 'function', 'match', 'with', 'type', 'of', 'module',
    'sig', 'struct', 'end', 'include', 'open', 'rec', 'and', 'when', 'try', 'exception',
    'mutable', 'begin', 'object', 'class', 'method', 'inherit', 'virtual', 'constraint',
    'private', 'functor',
  ),
  asm: kw(
    'mov', 'push', 'pop', 'call', 'ret', 'jmp', 'je', 'jne', 'jz', 'jnz', 'jg', 'jl', 'jge',
    'jle', 'add', 'sub', 'mul', 'div', 'inc', 'dec', 'and', 'or', 'xor', 'not', 'shl', 'shr',
    'lea', 'nop', 'int', 'cmp', 'test', 'leave', 'enter', 'hlt',
  ),
  go: [
    ...kw(
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
      'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
      'return', 'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false',
    ),
    ...fns(
      'append', 'cap', 'close', 'copy', 'delete', 'len', 'make', 'new', 'panic', 'print',
      'println', 'recover',
    ),
    ...types('string', 'int', 'int64', 'float64', 'bool', 'byte', 'rune', 'uint', 'error', 'any'),
  ],
  rs: [
    ...kw(
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
      'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move',
      'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait',
      'true', 'type', 'unsafe', 'use', 'where', 'while',
    ),
    ...types(
      'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
      'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec', 'Option', 'Result', 'Some', 'None',
      'Ok', 'Err',
    ),
    ...fns('println', 'print', 'format', 'vec', 'panic'),
  ],
  c: [
    ...kw(
      'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr',
      'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'extern',
      'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable',
      'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public',
      'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch',
      'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned',
      'using', 'virtual', 'void', 'volatile', 'while', 'include', 'define', 'ifndef', 'endif',
      'pragma', 'ifdef',
    ),
    ...fns('printf', 'malloc', 'free', 'memcpy', 'strlen', 'cout', 'cin', 'endl', 'std', 'vector', 'string', 'map', 'set'),
  ],
  java: kw(
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally',
    'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
    'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short',
    'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'sealed', 'true', 'false',
    'null', 'String', 'Integer', 'Boolean',
  ),
  php: kw(
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone',
    'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty',
    'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'enum', 'extends',
    'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if',
    'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset',
    'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public',
    'readonly', 'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait',
    'try', 'unset', 'use', 'var', 'while', 'xor', 'yield', 'true', 'false', 'null',
  ),
  yaml: kw('true', 'false', 'null'),
}

/** Stdlib identifiers for the languages above that don't fit the keyword
 * list (KEYWORDS is keyed by extension, these by language). */
const BUILTINS: Record<string, Completion[]> = {
  lua: fns(
    'print', 'require', 'tostring', 'tonumber', 'type', 'pairs', 'ipairs', 'pcall', 'error',
    'setmetatable', 'getmetatable', 'rawget', 'rawset', 'select', 'next', 'assert',
  ),
  r: fns(
    'print', 'cat', 'length', 'mean', 'median', 'sum', 'sd', 'var', 'min', 'max', 'summary',
    'plot', 'matrix', 'list', 'vector', 'apply', 'sapply', 'lapply', 'tapply', 'paste',
    'sprintf', 'head', 'tail', 'str', 'names', 'colnames', 'rownames',
  ),
  hs: fns(
    'map', 'foldr', 'foldl', 'filter', 'concat', 'zip', 'take', 'drop', 'head', 'tail',
    'length', 'reverse', 'Maybe', 'Just', 'Nothing', 'Either', 'Left', 'Right', 'putStrLn',
    'show', 'read', 'fmap', 'bind',
  ),
}

/** Merge language keywords with their builtins group. */
function keywordCompletions(key: string): Completion[] {
  return [...(KEYWORDS[key] ?? []), ...(BUILTINS[key] ?? [])]
}

const SNIPPETS: Record<string, Completion[]> = {
  js: JS_SNIPPETS,
  jsx: JS_SNIPPETS,
  mjs: JS_SNIPPETS,
  cjs: JS_SNIPPETS,
  ts: JS_SNIPPETS,
  tsx: JS_SNIPPETS,
  py: PY_SNIPPETS,
  go: GO_SNIPPETS,
  rs: RUST_SNIPPETS,
  java: JAVA_SNIPPETS,
  c: C_SNIPPETS,
  h: C_SNIPPETS,
  cpp: C_SNIPPETS,
  hpp: C_SNIPPETS,
  cc: C_SNIPPETS,
  hh: C_SNIPPETS,
}

/** Extensions that get document-wide word completion. Languages with native
 * completion sources and prose formats are excluded on purpose. */
const ANY_WORD = new Set([
  'cs', 'kt', 'kts', 'dart', 'm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'rb', 'lua', 'swift',
  'pl', 'pm', 'erl', 'hs', 'ml', 'mli', 'r', 'dockerfile', 'asm', 's', 'cmake', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'java', 'php', 'xml', 'yaml', 'yml',
])

const cache = new Map<string, Extension>()

/** Extra completion sources for a file extension, to load alongside the
 * language extension. Returns [] when the language needs nothing beyond its
 * built-in sources. */
export function completionExtras(extKey: string): Extension {
  let cached = cache.get(extKey)
  if (!cached) {
    const sources: CompletionSource[] = []
    const statics = [...keywordCompletions(extKey), ...(SNIPPETS[extKey] ?? [])]
    if (statics.length) sources.push(completeFromList(statics))
    if (ANY_WORD.has(extKey)) sources.push(completeAnyWord)
    // One languageData entry per source: the autocomplete property does not
    // reliably accept an array of sources here (the query stalls pending).
    cached = sources.length
      ? EditorState.languageData.of(() => sources.map((s) => ({ autocomplete: s })))
      : []
    cache.set(extKey, cached)
  }
  return cached
}
