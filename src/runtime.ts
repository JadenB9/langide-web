// Tiny in-browser runtime for LangIDE's natural-English language.
//
// This is a direct lexer → parser → tree-walking interpreter for the
// subset of the language that makes sense without a real compiler:
//
//   • types: number, decimal, truth, talking (+ precise decimal alias)
//   • variable decls:    `number x is 10`, `remember score as 42`
//   • assignment:        `make x be x plus 1`, `increase x`, `decrease x`
//   • printing:          `show quotes Hello ends quote`, `show x`,
//                         `tell me x`, `say x`, `display x`
//   • control flow:      `if COND then ... otherwise ... done`,
//                         `or if COND then ...` (cascaded)
//   • loops:             `repeat while COND do ... done`,
//                         `repeat until COND do ... done`,
//                         `repeat for i from A to B do ... done`,
//                         `repeat N times do ... done`,
//                         `count from A to B do ... done`,
//                         `loop forever do ... stop loop ... done`
//   • functions:         `task NAME taking TYPE a and TYPE b gives TYPE
//                          does ... done`, `call NAME with X and Y`,
//                         `give back EXPR`
//   • expressions:       + - * / %, comparisons, and also / or else,
//                         bitwise and/or/xor/not, shift left/right
//   • boolean literals:  yes / no
//   • loop control:      stop loop, skip to next, skip ahead
//
// Out of scope (the user gets a clear message): math functions (sqrt,
// pow, abs, round, sin, cos, …), input, sleep, arrays, recursion beyond
// depth 500, and anything that isn't listed above. For those, the UI
// points at the desktop macOS build.

type Value = number | string | boolean;

// ─────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────

type TokKind =
  | 'IDENT' | 'NUMBER' | 'STRING'
  | 'KW'                            // reserved word
  | 'NEWLINE' | 'EOF';

interface Token { kind: TokKind; value: string; line: number; }

// Reserved words we recognize as first-class. Multi-word keywords are
// normalized by the lexer into underscored tokens so the parser stays
// simple (e.g. `precise decimal` → `precise_decimal`).
const KEYWORDS = new Set([
  'task', 'taking', 'gives', 'does', 'done',
  'number', 'decimal', 'precise_decimal', 'truth', 'talking', 'nothing',
  'if', 'then', 'otherwise', 'or_if',
  'repeat', 'while', 'until', 'for', 'from', 'to', 'do',
  'keep_going_while', 'count_from', 'loop_forever',
  'times',
  'show', 'tell_me', 'say', 'display', 'print_out', 'print',
  'quotes', 'ends_quote',
  'make', 'be', 'is', 'as',
  'remember', 'give_back', 'call', 'with', 'and', 'or_else', 'and_also',
  'plus', 'minus', 'times_op', 'divided_by', 'modulo', 'mod',
  'equals', 'is_equal_to', 'is_not_equal_to', 'not_equals',
  'greater_than_or_equal_to', 'less_than_or_equal_to',
  'greater_than', 'less_than', 'at_least', 'at_most',
  'bitwise_and', 'bitwise_or', 'bitwise_xor', 'bitwise_not',
  'shift_left', 'shift_right',
  'yes', 'no',
  'stop_loop', 'skip_to_next', 'skip_ahead',
  'increase', 'decrease',
  'stop_everything', 'exit_program', 'quit',
]);

// Order matters — longer phrases win. Anything in this list is detected
// in the lexer and collapsed into a single token.
const MULTI_WORD: [string, string][] = [
  ['precise decimal',            'precise_decimal'],
  ['tell me',                    'tell_me'],
  ['print out',                  'print_out'],
  ['ends quote',                 'ends_quote'],
  ['give back',                  'give_back'],
  ['and also',                   'and_also'],
  ['or else',                    'or_else'],
  ['or if',                      'or_if'],
  ['divided by',                 'divided_by'],
  ['is equal to',                'is_equal_to'],
  ['is not equal to',            'is_not_equal_to'],
  ['not equals',                 'not_equals'],
  ['greater than or equal to',   'greater_than_or_equal_to'],
  ['less than or equal to',      'less_than_or_equal_to'],
  ['greater than',               'greater_than'],
  ['less than',                  'less_than'],
  ['at least',                   'at_least'],
  ['at most',                    'at_most'],
  ['bitwise and',                'bitwise_and'],
  ['bitwise or',                 'bitwise_or'],
  ['bitwise xor',                'bitwise_xor'],
  ['bitwise not',                'bitwise_not'],
  ['shift left',                 'shift_left'],
  ['shift right',                'shift_right'],
  ['stop loop',                  'stop_loop'],
  ['skip to next',               'skip_to_next'],
  ['skip ahead',                 'skip_ahead'],
  ['stop everything',            'stop_everything'],
  ['exit program',               'exit_program'],
  ['keep going while',           'keep_going_while'],
  ['count from',                 'count_from'],
  ['loop forever do',            'loop_forever'],
];

class Lexer {
  private src: string;
  private pos = 0;
  private line = 1;

  constructor(src: string) { this.src = src; }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\r') { this.pos++; continue; }
      if (c === '\n') {
        tokens.push({ kind: 'NEWLINE', value: '\n', line: this.line });
        this.pos++;
        this.line++;
        continue;
      }

      // Line comments: "note:", "comment:", "remark:"
      if (this.startsWithIgnoreCase('note:') ||
          this.startsWithIgnoreCase('comment:') ||
          this.startsWithIgnoreCase('remark:')) {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++;
        continue;
      }

      // `show quotes TEXT ends quote` — inline string literal form
      if (this.startsWithIgnoreCase('quotes')) {
        this.pos += 'quotes'.length;
        let str = '';
        while (this.pos < this.src.length && !this.startsWithIgnoreCase('ends quote')) {
          if (this.src[this.pos] === '\n') this.line++;
          str += this.src[this.pos++];
        }
        // Skip `ends quote`
        if (this.pos < this.src.length) this.pos += 'ends quote'.length;
        tokens.push({ kind: 'STRING', value: str.trim(), line: this.line });
        continue;
      }

      if (/[0-9]/.test(c)) {
        let n = '';
        while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos])) {
          n += this.src[this.pos++];
        }
        tokens.push({ kind: 'NUMBER', value: n, line: this.line });
        continue;
      }

      if (/[A-Za-z_]/.test(c)) {
        // Multi-word match first
        const multi = this.matchMultiWord();
        if (multi) {
          tokens.push({ kind: 'KW', value: multi, line: this.line });
          continue;
        }
        // Single word
        let w = '';
        while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos])) {
          w += this.src[this.pos++];
        }
        const lower = w.toLowerCase();
        if (lower === 'times') {
          // Ambiguous: `repeat 5 times do` uses `times`. `x times y`
          // uses `times` as multiply. We emit the same token and let the
          // parser disambiguate by context.
          tokens.push({ kind: 'KW', value: 'times', line: this.line });
        } else if (KEYWORDS.has(lower)) {
          tokens.push({ kind: 'KW', value: lower, line: this.line });
        } else {
          tokens.push({ kind: 'IDENT', value: w, line: this.line });
        }
        continue;
      }

      // Unknown char — skip
      this.pos++;
    }
    tokens.push({ kind: 'EOF', value: '', line: this.line });
    return tokens;
  }

  private matchMultiWord(): string | null {
    for (const [phrase, token] of MULTI_WORD) {
      if (this.startsWithIgnoreCaseWordBoundary(phrase)) {
        this.pos += phrase.length;
        return token;
      }
    }
    return null;
  }

  private startsWithIgnoreCase(s: string): boolean {
    return this.src.substring(this.pos, this.pos + s.length).toLowerCase() === s.toLowerCase();
  }

  private startsWithIgnoreCaseWordBoundary(s: string): boolean {
    if (!this.startsWithIgnoreCase(s)) return false;
    const after = this.pos + s.length;
    if (after >= this.src.length) return true;
    const next = this.src[after];
    return !/[A-Za-z0-9_]/.test(next);
  }
}

// ─────────────────────────────────────────────────────────────────────
// AST
// ─────────────────────────────────────────────────────────────────────

type Stmt =
  | { kind: 'varDecl'; type: string; name: string; init: Expr | null }
  | { kind: 'assign'; name: string; value: Expr }
  | { kind: 'show'; expr: Expr }
  | { kind: 'showString'; text: string }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[] | null }
  | { kind: 'while'; cond: Expr; body: Stmt[]; negated: boolean }
  | { kind: 'for'; varName: string; start: Expr; end: Expr; body: Stmt[] }
  | { kind: 'repeatN'; count: Expr; body: Stmt[] }
  | { kind: 'loopForever'; body: Stmt[] }
  | { kind: 'return'; value: Expr | null }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'exprStmt'; expr: Expr };

type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ident'; name: string }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'unary'; op: string; operand: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

interface FunctionDecl {
  name: string;
  params: { type: string; name: string }[];
  returnType: string;
  body: Stmt[];
}

interface Program {
  functions: FunctionDecl[];
  statements: Stmt[]; // top-level (rare, typically empty when main is present)
}

// ─────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    // Drop newline tokens — natural English doesn't use them as structure.
    this.tokens = tokens.filter(t => t.kind !== 'NEWLINE');
  }

  parse(): Program {
    const functions: FunctionDecl[] = [];
    const statements: Stmt[] = [];
    while (!this.isAtEnd()) {
      if (this.check('KW', 'task')) {
        functions.push(this.parseFunction());
      } else {
        statements.push(this.parseStatement());
      }
    }
    return { functions, statements };
  }

  // ─── Functions ──────────────────────────────────────────────────
  private parseFunction(): FunctionDecl {
    this.expectKw('task');
    const name = this.expectIdent();
    const params: { type: string; name: string }[] = [];
    let returnType = 'int';

    if (this.matchKw('taking')) {
      while (true) {
        const type = this.parseType();
        const paramName = this.expectIdent();
        params.push({ type, name: paramName });
        if (!this.matchKw('and')) break;
      }
    }
    if (this.matchKw('gives')) {
      returnType = this.parseType();
    } else if (name !== 'main') {
      returnType = 'void';
    }

    this.expectKw('does');
    const body = this.parseBlock(['done']);
    this.expectKw('done');

    return { name, params, returnType, body };
  }

  private parseType(): string {
    if (this.matchKw('number'))          return 'int';
    if (this.matchKw('precise_decimal')) return 'double';
    if (this.matchKw('decimal'))         return 'float';
    if (this.matchKw('truth'))           return 'bool';
    if (this.matchKw('talking'))         return 'string';
    if (this.matchKw('nothing'))         return 'void';
    throw new RuntimeErr(`Expected a type (number, decimal, truth, talking, nothing) at line ${this.peek().line}`);
  }

  private parseBlock(terminators: string[]): Stmt[] {
    const body: Stmt[] = [];
    while (!this.isAtEnd() && !this.isAtBlockEnd(terminators)) {
      body.push(this.parseStatement());
    }
    return body;
  }

  private isAtBlockEnd(terminators: string[]): boolean {
    const p = this.peek();
    if (p.kind !== 'KW') return false;
    if (terminators.includes(p.value)) return true;
    // `or if` / `otherwise` terminate if-branch bodies. Callers pass
    // ['done'] and let if-parsing peek for these separately.
    return false;
  }

  // ─── Statements ─────────────────────────────────────────────────
  private parseStatement(): Stmt {
    // Variable decl: type IDENT [is EXPR]
    if (this.checkKw('number') || this.checkKw('decimal') ||
        this.checkKw('precise_decimal') || this.checkKw('truth')) {
      const type = this.parseType();
      const name = this.expectIdent();
      let init: Expr | null = null;
      if (this.matchKw('is')) init = this.parseExpression();
      return { kind: 'varDecl', type, name, init };
    }

    // Special-case string decl: `talking X quotes TEXT ends quote` OR
    // `talking X is quotes TEXT ends quote`.
    if (this.checkKw('talking')) {
      this.advance();
      const name = this.expectIdent();
      this.matchKw('is'); // optional
      let init: Expr | null = null;
      if (this.peek().kind === 'STRING') {
        init = { kind: 'str', value: this.advance().value };
      } else if (!this.isAtEnd()) {
        init = this.parseExpression();
      }
      return { kind: 'varDecl', type: 'string', name, init };
    }

    if (this.matchKw('remember')) {
      const name = this.expectIdent();
      this.matchKw('as');
      const init = this.parseExpression();
      return { kind: 'varDecl', type: 'int', name, init };
    }

    if (this.matchKw('make')) {
      const name = this.expectIdent();
      this.expectKw('be');
      const value = this.parseExpression();
      return { kind: 'assign', name, value };
    }

    if (this.matchKw('increase')) {
      const name = this.expectIdent();
      return { kind: 'assign', name, value: { kind: 'binary', op: '+', left: { kind: 'ident', name }, right: { kind: 'num', value: 1 } } };
    }
    if (this.matchKw('decrease')) {
      const name = this.expectIdent();
      return { kind: 'assign', name, value: { kind: 'binary', op: '-', left: { kind: 'ident', name }, right: { kind: 'num', value: 1 } } };
    }

    // Print family
    if (this.matchKw('show') || this.matchKw('tell_me') || this.matchKw('say') ||
        this.matchKw('display') || this.matchKw('print_out') || this.matchKw('print')) {
      if (this.peek().kind === 'STRING') {
        const s = this.advance().value;
        return { kind: 'showString', text: s };
      }
      const expr = this.parseExpression();
      return { kind: 'show', expr };
    }

    if (this.matchKw('if')) {
      return this.parseIf();
    }

    if (this.matchKw('repeat')) {
      // `repeat while`, `repeat until`, `repeat for`, `repeat N times`
      if (this.matchKw('while')) {
        const cond = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock(['done']);
        this.expectKw('done');
        return { kind: 'while', cond, body, negated: false };
      }
      if (this.matchKw('until')) {
        const cond = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock(['done']);
        this.expectKw('done');
        return { kind: 'while', cond, body, negated: true };
      }
      if (this.matchKw('for')) {
        const varName = this.expectIdent();
        this.expectKw('from');
        const start = this.parseExpression();
        this.expectKw('to');
        const end = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock(['done']);
        this.expectKw('done');
        return { kind: 'for', varName, start, end, body };
      }
      // `repeat N times do ... done`
      // `times` in this grammar is a suffix, not a binary operator —
      // parse the count as a bare number (or identifier) only, to avoid
      // parseExpression consuming `times` as multiply.
      const countTok = this.peek();
      let count: Expr;
      if (countTok.kind === 'NUMBER') {
        this.advance();
        count = { kind: 'num', value: parseFloat(countTok.value) };
      } else if (countTok.kind === 'IDENT') {
        this.advance();
        count = { kind: 'ident', name: countTok.value };
      } else {
        throw new RuntimeErr(`Expected a count after 'repeat' at line ${countTok.line}`);
      }
      this.expectKw('times');
      this.expectKw('do');
      const body = this.parseBlock(['done']);
      this.expectKw('done');
      return { kind: 'repeatN', count, body };
    }

    if (this.matchKw('keep_going_while')) {
      const cond = this.parseExpression();
      this.expectKw('do');
      const body = this.parseBlock(['done']);
      this.expectKw('done');
      return { kind: 'while', cond, body, negated: false };
    }
    if (this.matchKw('count_from')) {
      const start = this.parseExpression();
      this.expectKw('to');
      const end = this.parseExpression();
      this.expectKw('do');
      const body = this.parseBlock(['done']);
      this.expectKw('done');
      return { kind: 'for', varName: '_c', start, end, body };
    }
    if (this.matchKw('loop_forever')) {
      const body = this.parseBlock(['done']);
      this.expectKw('done');
      return { kind: 'loopForever', body };
    }

    if (this.matchKw('give_back')) {
      if (this.isAtBlockEnd(['done']) || this.peek().kind === 'EOF') {
        return { kind: 'return', value: null };
      }
      return { kind: 'return', value: this.parseExpression() };
    }

    if (this.matchKw('stop_loop')) return { kind: 'break' };
    if (this.matchKw('skip_to_next') || this.matchKw('skip_ahead')) return { kind: 'continue' };

    if (this.matchKw('stop_everything') || this.matchKw('exit_program') || this.matchKw('quit')) {
      throw new ExitSignal();
    }

    // Fallback: treat as expression statement (e.g. a bare `call foo ...`)
    const expr = this.parseExpression();
    return { kind: 'exprStmt', expr };
  }

  private parseIf(): Stmt {
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    const firstCond = this.parseExpression();
    this.expectKw('then');
    const firstBody = this.parseIfBody();
    branches.push({ cond: firstCond, body: firstBody });

    while (this.matchKw('or_if')) {
      const cond = this.parseExpression();
      this.expectKw('then');
      const body = this.parseIfBody();
      branches.push({ cond, body });
    }

    let elseBody: Stmt[] | null = null;
    if (this.matchKw('otherwise')) {
      elseBody = this.parseIfBody();
    }
    this.expectKw('done');
    return { kind: 'if', branches, elseBody };
  }

  // If-branch body terminates at `or if`, `otherwise`, or `done`
  private parseIfBody(): Stmt[] {
    const body: Stmt[] = [];
    while (!this.isAtEnd()) {
      const p = this.peek();
      if (p.kind === 'KW' && (p.value === 'or_if' || p.value === 'otherwise' || p.value === 'done')) break;
      body.push(this.parseStatement());
    }
    return body;
  }

  // ─── Expressions ────────────────────────────────────────────────
  // Precedence (loosest first):
  //   or_else → and_also → bitwise_or → bitwise_xor → bitwise_and
  //   → equality → comparison → shift → additive → multiplicative
  //   → unary → primary
  private parseExpression(): Expr { return this.parseLogicalOr(); }

  private parseLogicalOr(): Expr {
    let expr = this.parseLogicalAnd();
    while (this.matchKw('or_else')) {
      const right = this.parseLogicalAnd();
      expr = { kind: 'binary', op: '||', left: expr, right };
    }
    return expr;
  }

  private parseLogicalAnd(): Expr {
    let expr = this.parseBitwiseOr();
    while (this.matchKw('and_also')) {
      const right = this.parseBitwiseOr();
      expr = { kind: 'binary', op: '&&', left: expr, right };
    }
    return expr;
  }

  private parseBitwiseOr(): Expr {
    let expr = this.parseBitwiseXor();
    while (this.matchKw('bitwise_or')) {
      const right = this.parseBitwiseXor();
      expr = { kind: 'binary', op: '|', left: expr, right };
    }
    return expr;
  }

  private parseBitwiseXor(): Expr {
    let expr = this.parseBitwiseAnd();
    while (this.matchKw('bitwise_xor')) {
      const right = this.parseBitwiseAnd();
      expr = { kind: 'binary', op: '^', left: expr, right };
    }
    return expr;
  }

  private parseBitwiseAnd(): Expr {
    let expr = this.parseEquality();
    while (this.matchKw('bitwise_and')) {
      const right = this.parseEquality();
      expr = { kind: 'binary', op: '&', left: expr, right };
    }
    return expr;
  }

  private parseEquality(): Expr {
    let expr = this.parseComparison();
    while (true) {
      if (this.matchKw('equals') || this.matchKw('is_equal_to')) {
        const right = this.parseComparison();
        expr = { kind: 'binary', op: '==', left: expr, right };
      } else if (this.matchKw('not_equals') || this.matchKw('is_not_equal_to')) {
        const right = this.parseComparison();
        expr = { kind: 'binary', op: '!=', left: expr, right };
      } else break;
    }
    return expr;
  }

  private parseComparison(): Expr {
    let expr = this.parseShift();
    while (true) {
      if (this.matchKw('greater_than_or_equal_to') || this.matchKw('at_least')) {
        const right = this.parseShift();
        expr = { kind: 'binary', op: '>=', left: expr, right };
      } else if (this.matchKw('less_than_or_equal_to') || this.matchKw('at_most')) {
        const right = this.parseShift();
        expr = { kind: 'binary', op: '<=', left: expr, right };
      } else if (this.matchKw('greater_than')) {
        const right = this.parseShift();
        expr = { kind: 'binary', op: '>', left: expr, right };
      } else if (this.matchKw('less_than')) {
        const right = this.parseShift();
        expr = { kind: 'binary', op: '<', left: expr, right };
      } else break;
    }
    return expr;
  }

  private parseShift(): Expr {
    let expr = this.parseAdditive();
    while (true) {
      if (this.matchKw('shift_left')) {
        const right = this.parseAdditive();
        expr = { kind: 'binary', op: '<<', left: expr, right };
      } else if (this.matchKw('shift_right')) {
        const right = this.parseAdditive();
        expr = { kind: 'binary', op: '>>', left: expr, right };
      } else break;
    }
    return expr;
  }

  private parseAdditive(): Expr {
    let expr = this.parseMultiplicative();
    while (true) {
      if (this.matchKw('plus')) {
        const right = this.parseMultiplicative();
        expr = { kind: 'binary', op: '+', left: expr, right };
      } else if (this.matchKw('minus')) {
        const right = this.parseMultiplicative();
        expr = { kind: 'binary', op: '-', left: expr, right };
      } else break;
    }
    return expr;
  }

  private parseMultiplicative(): Expr {
    let expr = this.parseUnary();
    while (true) {
      if (this.matchKw('times')) {
        const right = this.parseUnary();
        expr = { kind: 'binary', op: '*', left: expr, right };
      } else if (this.matchKw('divided_by')) {
        const right = this.parseUnary();
        expr = { kind: 'binary', op: '/', left: expr, right };
      } else if (this.matchKw('modulo') || this.matchKw('mod')) {
        const right = this.parseUnary();
        expr = { kind: 'binary', op: '%', left: expr, right };
      } else break;
    }
    return expr;
  }

  private parseUnary(): Expr {
    if (this.matchKw('bitwise_not')) {
      return { kind: 'unary', op: '~', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === 'NUMBER') {
      this.advance();
      return { kind: 'num', value: parseFloat(t.value) };
    }
    if (t.kind === 'STRING') {
      this.advance();
      return { kind: 'str', value: t.value };
    }
    if (t.kind === 'KW' && t.value === 'yes')  { this.advance(); return { kind: 'bool', value: true }; }
    if (t.kind === 'KW' && t.value === 'no')   { this.advance(); return { kind: 'bool', value: false }; }
    if (t.kind === 'KW' && t.value === 'call') {
      this.advance();
      const name = this.expectIdent();
      const args: Expr[] = [];
      if (this.matchKw('with')) {
        args.push(this.parseExpression());
        while (this.matchKw('and')) args.push(this.parseExpression());
      }
      return { kind: 'call', name, args };
    }
    if (t.kind === 'IDENT') {
      this.advance();
      return { kind: 'ident', name: t.value };
    }
    throw new RuntimeErr(`Unexpected token ${t.kind}${t.value ? ' \'' + t.value + '\'' : ''} at line ${t.line}`);
  }

  // ─── Helpers ────────────────────────────────────────────────────
  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }
  private isAtEnd(): boolean { return this.peek().kind === 'EOF'; }
  private check(kind: TokKind, value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.value !== value) return false;
    return true;
  }
  private checkKw(value: string): boolean { return this.check('KW', value); }
  private matchKw(value: string): boolean {
    if (this.checkKw(value)) { this.advance(); return true; }
    return false;
  }
  private expectKw(value: string): void {
    if (!this.matchKw(value)) {
      const t = this.peek();
      throw new RuntimeErr(`Expected '${value.replace(/_/g, ' ')}' at line ${t.line}, got '${t.value || t.kind}'`);
    }
  }
  private expectIdent(): string {
    const t = this.peek();
    if (t.kind !== 'IDENT') throw new RuntimeErr(`Expected a name at line ${t.line}, got '${t.value || t.kind}'`);
    this.advance();
    return t.value;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Interpreter
// ─────────────────────────────────────────────────────────────────────

class RuntimeErr extends Error {}
class BreakSignal {}
class ContinueSignal {}
class ExitSignal {}
class ReturnSignal { constructor(public value: Value | null) {} }

class Environment {
  private vars = new Map<string, Value>();
  constructor(public parent: Environment | null = null) {}
  get(name: string): Value {
    if (this.vars.has(name)) return this.vars.get(name)!;
    if (this.parent) return this.parent.get(name);
    throw new RuntimeErr(`Unknown variable '${name}'`);
  }
  set(name: string, value: Value): void {
    if (this.vars.has(name)) { this.vars.set(name, value); return; }
    if (this.parent && this.parent.has(name)) { this.parent.set(name, value); return; }
    this.vars.set(name, value);
  }
  has(name: string): boolean {
    if (this.vars.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }
  declare(name: string, value: Value): void { this.vars.set(name, value); }
}

class Interpreter {
  private functions = new Map<string, FunctionDecl>();
  private output: string[] = [];
  private steps = 0;
  private readonly STEP_LIMIT = 2_000_000;

  run(program: Program): string {
    for (const fn of program.functions) {
      this.functions.set(fn.name, fn);
    }
    // Execute top-level statements (rare) then main().
    const globalEnv = new Environment();
    for (const stmt of program.statements) this.execStmt(stmt, globalEnv);

    const main = this.functions.get('main');
    if (main) {
      try {
        this.callFunction(main, [], globalEnv);
      } catch (e) {
        if (e instanceof ExitSignal) { /* normal */ }
        else throw e;
      }
    }
    return this.output.join('\n') + (this.output.length ? '\n' : '');
  }

  private execBlock(stmts: Stmt[], env: Environment): void {
    for (const s of stmts) this.execStmt(s, env);
  }

  private execStmt(stmt: Stmt, env: Environment): void {
    if (++this.steps > this.STEP_LIMIT) {
      throw new RuntimeErr('Execution step limit reached (possible infinite loop)');
    }
    switch (stmt.kind) {
      case 'varDecl': {
        const v = stmt.init ? this.evalExpr(stmt.init, env) : this.defaultValueFor(stmt.type);
        env.declare(stmt.name, v);
        return;
      }
      case 'assign': {
        if (!env.has(stmt.name)) env.declare(stmt.name, 0);
        env.set(stmt.name, this.evalExpr(stmt.value, env));
        return;
      }
      case 'show': {
        const v = this.evalExpr(stmt.expr, env);
        this.output.push(this.formatValue(v));
        return;
      }
      case 'showString': {
        this.output.push(stmt.text);
        return;
      }
      case 'if': {
        for (const b of stmt.branches) {
          if (this.truthy(this.evalExpr(b.cond, env))) {
            this.execBlock(b.body, new Environment(env));
            return;
          }
        }
        if (stmt.elseBody) this.execBlock(stmt.elseBody, new Environment(env));
        return;
      }
      case 'while': {
        const loopEnv = new Environment(env);
        let iter = 0;
        while (true) {
          let condVal = this.truthy(this.evalExpr(stmt.cond, loopEnv));
          if (stmt.negated) condVal = !condVal;
          if (!condVal) break;
          if (++iter > 1_000_000) throw new RuntimeErr('Loop iteration limit reached');
          try {
            this.execBlock(stmt.body, loopEnv);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'for': {
        const loopEnv = new Environment(env);
        const startV = this.evalExpr(stmt.start, loopEnv);
        const endV = this.evalExpr(stmt.end, loopEnv);
        if (typeof startV !== 'number' || typeof endV !== 'number') {
          throw new RuntimeErr('for-loop bounds must be numbers');
        }
        loopEnv.declare(stmt.varName, startV);
        let iter = 0;
        while ((loopEnv.get(stmt.varName) as number) < endV) {
          if (++iter > 1_000_000) throw new RuntimeErr('Loop iteration limit reached');
          try {
            this.execBlock(stmt.body, loopEnv);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) {
              // fall through to increment
            } else throw e;
          }
          loopEnv.set(stmt.varName, (loopEnv.get(stmt.varName) as number) + 1);
        }
        return;
      }
      case 'repeatN': {
        const countV = this.evalExpr(stmt.count, env);
        if (typeof countV !== 'number') throw new RuntimeErr('repeat count must be a number');
        for (let i = 0; i < countV; i++) {
          try {
            this.execBlock(stmt.body, new Environment(env));
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'loopForever': {
        let iter = 0;
        while (true) {
          if (++iter > 1_000_000) throw new RuntimeErr('Loop iteration limit reached');
          try {
            this.execBlock(stmt.body, new Environment(env));
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
      }
      case 'return': {
        throw new ReturnSignal(stmt.value ? this.evalExpr(stmt.value, env) : null);
      }
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'exprStmt': this.evalExpr(stmt.expr, env); return;
    }
  }

  private evalExpr(expr: Expr, env: Environment): Value {
    if (++this.steps > this.STEP_LIMIT) {
      throw new RuntimeErr('Execution step limit reached');
    }
    switch (expr.kind) {
      case 'num':  return expr.value;
      case 'str':  return expr.value;
      case 'bool': return expr.value;
      case 'ident': return env.get(expr.name);
      case 'unary': {
        const v = this.evalExpr(expr.operand, env);
        if (expr.op === '~') {
          if (typeof v !== 'number') throw new RuntimeErr('bitwise not requires a number');
          return ~v;
        }
        throw new RuntimeErr(`Unknown unary operator ${expr.op}`);
      }
      case 'binary': {
        const l = this.evalExpr(expr.left, env);
        const r = this.evalExpr(expr.right, env);
        switch (expr.op) {
          case '+':
            if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
            return Number(l) + Number(r);
          case '-': return Number(l) - Number(r);
          case '*': return Number(l) * Number(r);
          case '/': return Number(l) / Number(r);
          case '%': return Number(l) % Number(r);
          case '<':  return Number(l) <  Number(r);
          case '>':  return Number(l) >  Number(r);
          case '<=': return Number(l) <= Number(r);
          case '>=': return Number(l) >= Number(r);
          case '==': return l === r;
          case '!=': return l !== r;
          case '&&': return this.truthy(l) && this.truthy(r);
          case '||': return this.truthy(l) || this.truthy(r);
          case '&':  return Number(l) & Number(r);
          case '|':  return Number(l) | Number(r);
          case '^':  return Number(l) ^ Number(r);
          case '<<': return Number(l) << Number(r);
          case '>>': return Number(l) >> Number(r);
        }
        throw new RuntimeErr(`Unknown binary operator ${expr.op}`);
      }
      case 'call': {
        const fn = this.functions.get(expr.name);
        if (!fn) throw new RuntimeErr(`Unknown function '${expr.name}'`);
        const argVals = expr.args.map(a => this.evalExpr(a, env));
        return this.callFunction(fn, argVals, env);
      }
    }
  }

  private callFunction(fn: FunctionDecl, args: Value[], _callerEnv: Environment): Value {
    const fnEnv = new Environment();
    for (let i = 0; i < fn.params.length; i++) {
      fnEnv.declare(fn.params[i].name, args[i] ?? this.defaultValueFor(fn.params[i].type));
    }
    try {
      this.execBlock(fn.body, fnEnv);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        return e.value ?? 0;
      }
      throw e;
    }
    return 0;
  }

  private defaultValueFor(type: string): Value {
    if (type === 'string') return '';
    if (type === 'bool')   return false;
    return 0;
  }

  private truthy(v: Value): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number')  return v !== 0;
    if (typeof v === 'string')  return v.length > 0;
    return false;
  }

  private formatValue(v: Value): string {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return v.toString();
      return v.toString();
    }
    return String(v);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export interface RunResult {
  success: boolean;
  output: string;
  error?: string;
}

export function runProgram(source: string): RunResult {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const interp = new Interpreter();
    const output = interp.run(program);
    return { success: true, output };
  } catch (e) {
    if (e instanceof RuntimeErr) return { success: false, output: '', error: e.message };
    if (e instanceof ExitSignal) return { success: true, output: '' };
    const msg = (e as Error).message || String(e);
    return { success: false, output: '', error: msg };
  }
}
