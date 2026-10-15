// Turns a parsed program into C, Python or JavaScript — the same three
// targets as the desktop LangIDE. The output is meant to be read (and
// compiled, if you save it), so it keeps the names from the English
// source and only adds parentheses where precedence needs them.
//
// `number` variables are C ints in the runtime, so when a float lands in
// one (`number half is 7 divided by 2`) the Python and JS versions wrap
// the value in int()/Math.trunc() to keep the same answer.

import type { Program, FunctionDecl, Stmt, Expr } from './runtime';

export type Target = 'c' | 'python' | 'javascript';

export const TARGET_LABELS: Record<Target, string> = {
  c: 'C',
  python: 'Python',
  javascript: 'JavaScript',
};

export const TARGET_EXTENSIONS: Record<Target, string> = {
  c: 'c',
  python: 'py',
  javascript: 'js',
};

type Type = 'int' | 'float' | 'double' | 'bool' | 'string' | 'void';

const INDENT = '    ';

// Operator precedence, C-style — higher binds tighter
const PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
};
const UNARY_PRECEDENCE = 11;
const POW_PRECEDENCE = 12;

export function generate(program: Program, target: Target): string {
  return new Generator(target).program(program);
}

class Generator {
  private target: Target;
  private depth = 0;
  // Declared type of every variable we've seen, so `show x` can pick a
  // printf format and int targets know when to truncate
  private types = new Map<string, Type>();
  private functions = new Map<string, FunctionDecl>();
  private usesMath = false;
  private usesStdlib = false;   // exit(), abs()
  private usesBool = false;
  private usesMinMax = false;

  constructor(target: Target) { this.target = target; }

  // ─── Program ────────────────────────────────────────────────────
  program(p: Program): string {
    for (const fn of p.functions) this.functions.set(fn.name, fn);
    for (const fn of p.functions) {
      for (const param of fn.params) this.types.set(param.name, param.type as Type);
    }

    const main = p.functions.find(fn => fn.name === 'main');
    const others = p.functions.filter(fn => fn.name !== 'main');
    // Top-level declarations become globals; other top-level statements
    // run before main, which is what the runtime does too
    const globalDecls = p.statements.filter(s => s.kind === 'varDecl');
    const topLevel = p.statements.filter(s => s.kind !== 'varDecl');

    // Functions, then the loose statements, separated by blank lines
    const parts: string[] = others.map(fn => this.function(fn));

    if (this.target === 'c') {
      let globals = '';
      for (const s of globalDecls) globals += this.statement(s);
      // Either the user's main or one made from the loose statements
      if (main) parts.push(this.function(main, topLevel));
      else if (topLevel.length) {
        parts.push(this.function({ name: 'main', line: 0, params: [], returnType: 'int', body: topLevel }));
      }
      if (globals) parts.unshift(globals);
      return this.cHeader() + this.join(parts);
    }

    if (main) parts.push(this.function(main));
    let tail = '';
    for (const s of p.statements) tail += this.statement(s);
    if (main) tail += this.target === 'python' ? 'main()\n' : 'main();\n';
    if (tail) parts.push(tail);

    let head = '';
    if (this.target === 'python') {
      if (this.usesMath) head += 'import math\n';
      if (this.usesStdlib) head += 'import sys\n';
    }
    return (head ? head + '\n' : '') + this.join(parts);
  }

  private join(parts: string[]): string {
    return parts.map(p => p.trimEnd()).join('\n\n') + '\n';
  }

  private cHeader(): string {
    let h = '#include <stdio.h>\n';
    if (this.usesStdlib) h += '#include <stdlib.h>\n';
    if (this.usesBool) h += '#include <stdbool.h>\n';
    if (this.usesMath) h += '#include <math.h>\n';
    h += '\n';
    if (this.usesMinMax) {
      h += '#define __lang_max(a, b) ((a) > (b) ? (a) : (b))\n';
      h += '#define __lang_min(a, b) ((a) < (b) ? (a) : (b))\n\n';
    }
    return h;
  }

  // ─── Functions ──────────────────────────────────────────────────
  private function(fn: FunctionDecl, prelude: Stmt[] = []): string {
    const params = fn.params.map(p =>
      this.target === 'c' ? `${this.cType(p.type as Type)} ${p.name}` : p.name);
    let out = '';
    if (this.target === 'c') {
      out += `${this.cType(fn.returnType as Type)} ${fn.name}(${params.join(', ') || 'void'}) {\n`;
    } else if (this.target === 'python') {
      out += `def ${fn.name}(${params.join(', ')}):\n`;
    } else {
      out += `function ${fn.name}(${params.join(', ')}) {\n`;
    }
    this.depth++;
    let body = '';
    for (const s of prelude) body += this.statement(s);
    for (const s of fn.body) body += this.statement(s, fn);
    if (this.target === 'python' && !body) body = this.indent() + 'pass\n';
    // C's main returns 0 unless the program already returned something
    if (this.target === 'c' && fn.name === 'main' && fn.body[fn.body.length - 1]?.kind !== 'return') {
      body += this.indent() + 'return 0;\n';
    }
    this.depth--;
    out += body;
    if (this.target !== 'python') out += '}\n';
    return out;
  }

  // ─── Statements ─────────────────────────────────────────────────
  private statement(s: Stmt, fn?: FunctionDecl): string {
    const ind = this.indent();
    switch (s.kind) {
      case 'varDecl': {
        const type = s.type as Type;
        this.types.set(s.name, type);
        if (type === 'bool') this.usesBool = true;
        const value = s.init ? this.store(s.init, type) : this.defaultValue(type);
        if (this.target === 'c') return `${ind}${this.cType(type)} ${s.name} = ${value};\n`;
        if (this.target === 'python') return `${ind}${s.name} = ${value}\n`;
        return `${ind}let ${s.name} = ${value};\n`;
      }
      case 'assign': {
        const value = this.store(s.value, this.types.get(s.name) ?? null);
        return `${ind}${s.name} = ${value}${this.semi()}\n`;
      }
      case 'show':
        return ind + this.print(s.expr) + this.semi() + '\n';
      case 'if': {
        let out = '';
        s.branches.forEach((b, i) => {
          const cond = this.expr(b.cond);
          if (this.target === 'python') {
            out += `${ind}${i === 0 ? 'if' : 'elif'} ${cond}:\n` + this.block(b.body);
          } else {
            out += (i === 0 ? `${ind}if (${cond}) {\n` : ` else if (${cond}) {\n`) + this.block(b.body) + `${ind}}`;
          }
        });
        if (s.elseBody) {
          if (this.target === 'python') out += `${ind}else:\n` + this.block(s.elseBody);
          else out += ' else {\n' + this.block(s.elseBody) + `${ind}}`;
        }
        return out + (this.target === 'python' ? '' : '\n');
      }
      case 'while': {
        const cond = this.expr(s.cond);
        if (this.target === 'python') {
          return `${ind}while ${s.negated ? `not (${cond})` : cond}:\n` + this.block(s.body);
        }
        return `${ind}while (${s.negated ? `!(${cond})` : cond}) {\n` + this.block(s.body) + `${ind}}\n`;
      }
      case 'for': {
        this.types.set(s.varName, 'int');
        const from = this.expr(s.start);
        const to = this.expr(s.end);
        if (this.target === 'python') {
          return `${ind}for ${s.varName} in range(${from}, ${to}):\n` + this.block(s.body);
        }
        const decl = this.target === 'c' ? 'int' : 'let';
        return `${ind}for (${decl} ${s.varName} = ${from}; ${s.varName} < ${to}; ${s.varName}++) {\n` +
          this.block(s.body) + `${ind}}\n`;
      }
      case 'repeatN': {
        const count = this.expr(s.count);
        if (this.target === 'python') {
          return `${ind}for _ in range(${count}):\n` + this.block(s.body);
        }
        const decl = this.target === 'c' ? 'int' : 'let';
        return `${ind}for (${decl} _i = 0; _i < ${count}; _i++) {\n` + this.block(s.body) + `${ind}}\n`;
      }
      case 'loopForever':
        if (this.target === 'python') return `${ind}while True:\n` + this.block(s.body);
        return `${ind}while (${this.target === 'c' ? '1' : 'true'}) {\n` + this.block(s.body) + `${ind}}\n`;
      case 'return': {
        if (!s.value) return `${ind}return${this.semi()}\n`;
        const value = this.store(s.value, (fn?.returnType as Type) ?? null);
        return `${ind}return ${value}${this.semi()}\n`;
      }
      case 'break':    return `${ind}break${this.semi()}\n`;
      case 'continue': return `${ind}continue${this.semi()}\n`;
      case 'exit':
        this.usesStdlib = true;
        if (this.target === 'c')      return `${ind}exit(0);\n`;
        if (this.target === 'python') return `${ind}sys.exit(0)\n`;
        return `${ind}process.exit(0);\n`;
      case 'exprStmt':
        return ind + this.expr(s.expr) + this.semi() + '\n';
    }
  }

  private block(body: Stmt[]): string {
    this.depth++;
    let out = '';
    for (const s of body) out += this.statement(s);
    if (this.target === 'python' && !out) out = this.indent() + 'pass\n';
    this.depth--;
    return out;
  }

  private print(e: Expr): string {
    const value = this.expr(e);
    if (this.target === 'python') return `print(${value})`;
    if (this.target === 'javascript') return `console.log(${value})`;
    switch (this.inferType(e)) {
      case 'string': return `printf("%s\\n", ${value})`;
      case 'float':
      case 'double': return `printf("%g\\n", ${value})`;
      case 'bool':   return `printf("%s\\n", ${this.wrap(e, value, 15)} ? "true" : "false")`;
      default:       return `printf("%d\\n", ${value})`;
    }
  }

  // A value going into a typed slot: ints truncate like the runtime does
  private store(e: Expr, type: Type | null): string {
    const value = this.expr(e);
    if (type !== 'int' || this.target === 'c') return value;
    const from = this.inferType(e);
    if (from === 'int' || from === 'bool' || from === 'string') return value;
    return this.target === 'python' ? `int(${value})` : `Math.trunc(${value})`;
  }

  private defaultValue(type: Type): string {
    if (type === 'string') return '""';
    if (type === 'bool') return this.target === 'python' ? 'False' : 'false';
    return '0';
  }

  // ─── Expressions ────────────────────────────────────────────────
  private expr(e: Expr): string {
    switch (e.kind) {
      case 'num':   return String(e.value);
      case 'str':   return JSON.stringify(e.value);
      case 'bool':
        this.usesBool = true;
        if (this.target === 'python') return e.value ? 'True' : 'False';
        return e.value ? 'true' : 'false';
      case 'ident': return e.name;
      case 'unary':
        return '~' + this.wrap(e.operand, this.expr(e.operand), UNARY_PRECEDENCE);
      case 'binary': {
        const prec = PRECEDENCE[e.op];
        const left = this.wrap(e.left, this.expr(e.left), prec);
        // Right side needs parens at equal precedence too: a - (b - c)
        const right = this.wrap(e.right, this.expr(e.right), prec + 1);
        return `${this.pyStr(e, e.left, left)} ${this.op(e.op)} ${this.pyStr(e, e.right, right)}`;
      }
      case 'call':
        return this.call(e);
    }
  }

  // Python can't add text and numbers, so `name plus 1` becomes
  // str(name) + str(1) when either side is text
  private pyStr(parent: Expr & { kind: 'binary' }, side: Expr, rendered: string): string {
    if (this.target !== 'python' || parent.op !== '+') return rendered;
    const l = this.inferType(parent.left);
    const r = this.inferType(parent.right);
    if (l !== 'string' && r !== 'string') return rendered;
    if (this.inferType(side) === 'string') return rendered;
    return `str(${rendered})`;
  }

  private op(op: string): string {
    if (this.target === 'python') {
      if (op === '&&') return 'and';
      if (op === '||') return 'or';
    }
    if (this.target === 'javascript') {
      if (op === '==') return '===';
      if (op === '!=') return '!==';
    }
    return op;
  }

  // Parenthesize `rendered` when its own precedence is looser than `min`
  private wrap(e: Expr, rendered: string, min: number): string {
    return this.precedenceOf(e) < min ? `(${rendered})` : rendered;
  }

  private precedenceOf(e: Expr): number {
    if (e.kind === 'binary') return PRECEDENCE[e.op];
    if (e.kind === 'unary') return UNARY_PRECEDENCE;
    if (e.kind === 'call' && e.name === '__builtin_pow' && this.target === 'python') return POW_PRECEDENCE;
    if (e.kind === 'num' && e.value < 0) return UNARY_PRECEDENCE;
    return 100;
  }

  private call(e: Expr & { kind: 'call' }): string {
    const args = e.args.map(a => this.expr(a));
    if (!e.name.startsWith('__builtin_')) return `${e.name}(${args.join(', ')})`;
    const name = e.name.slice('__builtin_'.length);
    this.usesMath = true;

    if (name === 'pow') {
      if (this.target === 'python') {
        return `${this.wrap(e.args[0], args[0], POW_PRECEDENCE + 1)} ** ${this.wrap(e.args[1], args[1], POW_PRECEDENCE)}`;
      }
      return `${this.target === 'c' ? 'pow' : 'Math.pow'}(${args[0]}, ${args[1]})`;
    }
    if (name === 'max' || name === 'min') {
      if (this.target === 'c') { this.usesMinMax = true; return `__lang_${name}(${args[0]}, ${args[1]})`; }
      if (this.target === 'python') return `${name}(${args[0]}, ${args[1]})`;
      return `Math.${name}(${args[0]}, ${args[1]})`;
    }
    if (this.target === 'c') {
      // abs() is the int one in C (from stdlib); floats want fabs()
      if (name === 'abs' && this.inferType(e.args[0]) === 'int') {
        this.usesStdlib = true;
        return `abs(${args[0]})`;
      }
      return `${name === 'abs' ? 'fabs' : name}(${args[0]})`;
    }
    if (this.target === 'python') {
      if (name === 'abs' || name === 'round') return `${name}(${args[0]})`;
      return `math.${name}(${args[0]})`;
    }
    return `Math.${name}(${args[0]})`;
  }

  // Best guess at what an expression evaluates to, from literals and the
  // declared types we've seen. Decides printf formats and int truncation.
  private inferType(e: Expr): Type {
    switch (e.kind) {
      case 'num':   return Number.isInteger(e.value) ? 'int' : 'double';
      case 'str':   return 'string';
      case 'bool':  return 'bool';
      case 'ident': return this.types.get(e.name) ?? 'int';
      case 'unary': return 'int';
      case 'binary': {
        if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(e.op)) return 'bool';
        const l = this.inferType(e.left);
        const r = this.inferType(e.right);
        if (e.op === '+' && (l === 'string' || r === 'string')) return 'string';
        if (e.op === '/') return 'double';
        if (l === 'double' || r === 'double') return 'double';
        if (l === 'float' || r === 'float') return 'float';
        return 'int';
      }
      case 'call': {
        if (e.name.startsWith('__builtin_')) {
          const name = e.name.slice('__builtin_'.length);
          // Rounding gives a whole number — but C's floor/ceil/round
          // still return a double
          if (['floor', 'ceil', 'round'].includes(name)) return this.target === 'c' ? 'double' : 'int';
          if (name === 'abs' || name === 'max' || name === 'min') {
            return e.args.some(a => this.inferType(a) !== 'int') ? 'double' : 'int';
          }
          return 'double';
        }
        return (this.functions.get(e.name)?.returnType as Type) ?? 'int';
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────
  private cType(t: Type): string {
    if (t === 'string') return 'const char*';
    if (t === 'bool') { this.usesBool = true; return 'bool'; }
    return t;
  }

  private semi(): string { return this.target === 'python' ? '' : ';'; }
  private indent(): string { return INDENT.repeat(this.depth); }
}
