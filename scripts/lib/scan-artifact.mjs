/**
 * 浏览器产物静态扫描：基于 acorn AST 判断标识符是否为“自由引用”（未被本地声明遮蔽）。
 *
 * 用途：`scripts/check-browser.mjs` 构建期校验与 `test/browser-entry.test.js` 回归测试。
 */
import { parse } from 'acorn';
import { fullAncestor } from 'acorn-walk';

/**
 * 先按 ESM 解析，失败再按脚本解析（IIFE 两者都合法，但 ESM 允许 import/export）。
 * @param {string} code
 */
function parseAny(code) {
  /** @type {any} */
  const base = { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true };
  try {
    return parse(code, { ...base, sourceType: 'module' });
  } catch {
    return parse(code, { ...base, sourceType: 'script' });
  }
}

/**
 * 判断标识符是否处于“属性名/标签/导入导出名”等非引用位置。
 * @param {any} node
 * @param {any} parent
 */
function isNonReferencePosition(node, parent) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'LabeledStatement' && parent.label === node) return true;
  if (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return true;
  if (parent.type === 'ExportSpecifier' || parent.type === 'ImportSpecifier') return true;
  return false;
}

/**
 * 判断标识符是否在“声明”位置。
 * @param {any} node
 * @param {any} parent
 */
function isDeclarationPosition(node, parent) {
  if (!parent) return false;
  if (parent.type === 'VariableDeclarator' && parent.id === node) return true;
  if (
    (parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression') &&
    parent.params?.includes(node)
  ) {
    return true;
  }
  if (parent.type === 'CatchClause' && parent.param === node) return true;
  if (parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') return true;
  return false;
}

/**
 * @param {any} node
 * @param {any} parent
 */
function referenceKind(node, parent) {
  if (!parent) return 'bare';
  if (parent.type === 'MemberExpression' && parent.object === node) return 'member';
  if (parent.type === 'CallExpression' && parent.callee === node) return 'call';
  if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return 'typeof';
  if (parent.type === 'AssignmentExpression') return 'assignment';
  return 'bare';
}

/**
 * 扫描指定全局名在产物中的自由引用与声明数量。
 *
 * “自由引用”= 不以属性名出现、也不在本文件被声明遮蔽的标识符引用；
 * 例如 `process.nextTick(...)`、`typeof process`、`console.log(process)` 都会被计入，
 * 而 `this.processWriteQueue()`、字符串 "process" 不会。
 *
 * @param {string} code
 * @param {string[]} names
 * @returns {{ refs: Array<{ name: string, kind: string, line: number, col: number }>, declarations: Array<{ name: string, line: number, col: number }> }}
 */
export function scanFreeReferences(code, names) {
  const ast = parseAny(code);
  /** @type {Array<{ name: string, kind: string, line: number, col: number }>} */
  const refs = [];
  /** @type {Array<{ name: string, line: number, col: number }>} */
  const declarations = [];

  fullAncestor(ast, (node, _state, ancestors) => {
    if (node.type !== 'Identifier' || !names.includes(node.name)) return;
    const parent = ancestors[ancestors.length - 2];
    if (isNonReferencePosition(node, parent)) return;
    const position = { line: node.loc.start.line, col: node.loc.start.column };
    if (isDeclarationPosition(node, parent)) {
      declarations.push({ name: node.name, ...position });
      return;
    }
    refs.push({ name: node.name, kind: referenceKind(node, parent), ...position });
  });

  return { refs, declarations };
}

/**
 * 找出产物里真实存在的 Node 内置模块引用（`node:*` 与裸内置名）。
 * @param {string} code
 * @param {string[]} [builtins]
 * @returns {string[]}
 */
export function findNodeBuiltinImports(code, builtins = ['crypto', 'events', 'buffer', 'stream', 'util', 'vm']) {
  const ast = parseAny(code);
  /** @type {Set<string>} */
  const found = new Set();
  const isBuiltin = (/** @type {string} */ specifier) => {
    if (specifier.startsWith('node:')) return true;
    const bare = specifier.replace(/\/.*$/, '');
    return builtins.includes(bare);
  };
  const record = (/** @type {string} */ value) => {
    if (typeof value === 'string' && isBuiltin(value)) found.add(value);
  };

  fullAncestor(ast, (node) => {
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ExportAllDeclaration' ||
        node.type === 'ExportNamedDeclaration') &&
      node.source
    ) {
      record(node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source.type === 'Literal') record(node.source.value);
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      node.arguments[0]?.type === 'Literal'
    ) {
      record(node.arguments[0].value);
    }
  });

  return [...found];
}
