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
//   • expressions:       plus minus times divided by modulo, comparisons,
//                         and also / or else, bitwise and/or/xor/not,
//                         shift left/right, ( parentheses )
//   • math:              square root of, absolute value of, rounded,
//                         to the power of, maximum of A and B, …
//   • literals:          yes / no, -5, 3.14, "text" or quotes … ends quote
//   • loop control:      stop loop, skip to next, skip ahead
//   • exit:              stop everything, exit program, quit
//
// `number` variables hold whole numbers like a C int, so `number half is
// 7 divided by 2` stores 3. Out of scope: input, sleep and arrays — for
// those the UI points at the desktop macOS build. Errors carry the line
// they happened on so the editor can jump there.

type Value = number | string | boolean;

// ─────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────

type TokKind =
  | 'IDENT' | 'NUMBER' | 'STRING'
  | 'KW'                            // reserved word
  | 'LPAREN' | 'RPAREN'
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
  // Math builtins (prefix unary)
  'square_root_of', 'absolute_value_of',
  'rounded_down', 'rounded_up', 'rounded',
  'sine_of', 'cosine_of', 'tangent_of', 'logarithm_of',
  // Two-arg builtins
  'maximum_of', 'minimum_of', 'bigger_of', 'smaller_of',
  // Infix exponent
  'to_the_power_of',
]);

// Order matters — longer phrases win. Anything in this list is detected
// in the lexer and collapsed into a single token.
const MULTI_WORD: [string, string][] = [
  // Math (longest first to beat shorter prefixes)
  ['greater than or equal to',   'greater_than_or_equal_to'],
  ['less than or equal to',      'less_than_or_equal_to'],
  ['is not equal to',            'is_not_equal_to'],
  ['to the power of',            'to_the_power_of'],
  ['absolute value of',          'absolute_value_of'],
  ['square root of',             'square_root_of'],
  ['keep going while',           'keep_going_while'],
  ['precise decimal',            'precise_decimal'],
  ['logarithm of',               'logarithm_of'],
  ['stop everything',            'stop_everything'],
  ['exit program',               'exit_program'],
  ['rounded down',               'rounded_down'],
  ['rounded up',                 'rounded_up'],
  ['skip to next',               'skip_to_next'],
  ['loop forever do',            'loop_forever'],
  ['is equal to',                'is_equal_to'],
  ['not equals',                 'not_equals'],
  ['count from',                 'count_from'],
  ['greater than',               'greater_than'],
  ['less than',                  'less_than'],
  ['maximum of',                 'maximum_of'],
  ['minimum of',                 'minimum_of'],
  ['bigger of',                  'bigger_of'],
  ['smaller of',                 'smaller_of'],
  ['cosine of',                  'cosine_of'],
  ['tangent of',                 'tangent_of'],
  ['sine of',                    'sine_of'],
  ['skip ahead',                 'skip_ahead'],
  ['stop loop',                  'stop_loop'],
  ['ends quote',                 'ends_quote'],
  ['give back',                  'give_back'],
  ['divided by',                 'divided_by'],
  ['bitwise and',                'bitwise_and'],
  ['bitwise or',                 'bitwise_or'],
  ['bitwise xor',                'bitwise_xor'],
  ['bitwise not',                'bitwise_not'],
  ['shift left',                 'shift_left'],
  ['shift right',                'shift_right'],
  ['print out',                  'print_out'],
  ['tell me',                    'tell_me'],
  ['and also',                   'and_also'],
  ['or else',                    'or_else'],
  ['at least',                   'at_least'],
  ['at most',                    'at_most'],
  ['or if',                      'or_if'],
];

// Symbols people type out of habit, and the word the language wants instead
const SYMBOL_WORDS: Record<string, string> = {
  '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '%': 'modulo',
  '=': 'is (or equals)', '<': 'less than', '>': 'greater than',
};

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
      if (this.startsWithIgnoreCaseWordBoundary('quotes')) {
        const startLine = this.line;
        this.pos += 'quotes'.length;
        let str = '';
        while (this.pos < this.src.length && !this.startsWithIgnoreCase('ends quote')) {
          if (this.src[this.pos] === '\n') this.line++;
          str += this.src[this.pos++];
        }
        if (this.pos >= this.src.length) {
          throw new RuntimeErr("this text is missing 'ends quote' after it", startLine);
        }
        this.pos += 'ends quote'.length;
        tokens.push({ kind: 'STRING', value: str.trim(), line: startLine });
        continue;
      }

      // "text" — plain double quotes work too, and keep their spaces
      if (c === '"') {
        const end = this.src.indexOf('"', this.pos + 1);
        const newline = this.src.indexOf('\n', this.pos + 1);
        if (end === -1 || (newline !== -1 && newline < end)) {
          throw new RuntimeErr('this text is missing its closing "', this.line);
        }
        tokens.push({ kind: 'STRING', value: this.src.slice(this.pos + 1, end), line: this.line });
        this.pos = end + 1;
        continue;
      }

      // A minus sign right before a digit is a negative number, unless it
      // follows a value (then it was meant as subtraction)
      const prev = tokens[tokens.length - 1];
      const afterValue = prev && (prev.kind === 'NUMBER' || prev.kind === 'IDENT' ||
                                  prev.kind === 'STRING' || prev.kind === 'RPAREN');
      if (/[0-9]/.test(c) || (c === '-' && !afterValue && /[0-9]/.test(this.src[this.pos + 1] ?? ''))) {
        let n = c;
        this.pos++;
        while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos])) {
          n += this.src[this.pos++];
        }
        tokens.push({ kind: 'NUMBER', value: n, line: this.line });
        continue;
      }

      if (c === '(' || c === ')') {
        tokens.push({ kind: c === '(' ? 'LPAREN' : 'RPAREN', value: c, line: this.line });
        this.pos++;
        continue;
      }

      if (c in SYMBOL_WORDS) {
        throw new RuntimeErr(`use '${SYMBOL_WORDS[c]}' instead of '${c}'`, this.line);
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

      // Other punctuation (commas, full stops, …) is ignored
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

type StmtBody =
  | { kind: 'varDecl'; type: string; name: string; init: Expr | null }
  | { kind: 'assign'; name: string; value: Expr }
  | { kind: 'show'; expr: Expr }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[] | null }
  | { kind: 'while'; cond: Expr; body: Stmt[]; negated: boolean }
  | { kind: 'for'; varName: string; start: Expr; end: Expr; body: Stmt[] }
  | { kind: 'repeatN'; count: Expr; body: Stmt[] }
  | { kind: 'loopForever'; body: Stmt[] }
  | { kind: 'return'; value: Expr | null }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'exit' }
  | { kind: 'exprStmt'; expr: Expr };

// Every statement remembers its source line for error messages
type Stmt = StmtBody & { line: number };

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
  line: number;
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
    const line = this.peek().line;
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
    const body = this.parseBlock(`task ${name}`, line);

    return { name, line, params, returnType, body };
  }

  private parseType(): string {
    if (this.matchKw('number'))          return 'int';
    if (this.matchKw('precise_decimal')) return 'double';
    if (this.matchKw('decimal'))         return 'float';
    if (this.matchKw('truth'))           return 'bool';
    if (this.matchKw('talking'))         return 'string';
    if (this.matchKw('nothing'))         return 'void';
    throw new RuntimeErr(`expected a type (number, decimal, truth, talking or nothing) but found ${this.describe(this.peek())}`, this.peek().line);
  }

  // Statements up to and including the block's closing `done`. `opener`
  // names the block so a missing `done` can say which one it belongs to.
  private parseBlock(opener: string, openLine: number): Stmt[] {
    const body: Stmt[] = [];
    while (!this.isAtEnd() && !this.checkKw('done')) {
      body.push(this.parseStatement());
    }
    this.expectDone(opener, openLine);
    return body;
  }

  private expectDone(opener: string, openLine: number): void {
    if (this.matchKw('done')) return;
    throw new RuntimeErr(`'${opener}' (line ${openLine}) is missing its closing 'done'`, openLine);
  }

  // ─── Statements ─────────────────────────────────────────────────
  private parseStatement(): Stmt {
    const line = this.peek().line;
    return { ...this.parseStatementBody(), line };
  }

  private parseStatementBody(): StmtBody {
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
      // `is` is optional before a quoted string
      let init: Expr | null = null;
      if (this.matchKw('is') || this.peek().kind === 'STRING') {
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
      return { kind: 'show', expr: this.parseExpression() };
    }

    if (this.checkKw('if')) {
      return this.parseIf();
    }

    const startLine = this.peek().line;
    if (this.matchKw('repeat')) {
      // `repeat while`, `repeat until`, `repeat for`, `repeat N times`
      if (this.matchKw('while')) {
        const cond = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock('repeat while', startLine);
        return { kind: 'while', cond, body, negated: false };
      }
      if (this.matchKw('until')) {
        const cond = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock('repeat until', startLine);
        return { kind: 'while', cond, body, negated: true };
      }
      if (this.matchKw('for')) {
        const varName = this.expectIdent();
        this.expectKw('from');
        const start = this.parseExpression();
        this.expectKw('to');
        const end = this.parseExpression();
        this.expectKw('do');
        const body = this.parseBlock(`repeat for ${varName}`, startLine);
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
        throw new RuntimeErr(`'repeat' needs while, until, for, or a count like 'repeat 5 times do'`, countTok.line);
      }
      this.expectKw('times');
      this.expectKw('do');
      const body = this.parseBlock('repeat … times', startLine);
      return { kind: 'repeatN', count, body };
    }

    if (this.matchKw('keep_going_while')) {
      const cond = this.parseExpression();
      this.expectKw('do');
      const body = this.parseBlock('keep going while', startLine);
      return { kind: 'while', cond, body, negated: false };
    }
    if (this.matchKw('count_from')) {
      const start = this.parseExpression();
      this.expectKw('to');
      const end = this.parseExpression();
      this.expectKw('do');
      const body = this.parseBlock('count from', startLine);
      return { kind: 'for', varName: '_c', start, end, body };
    }
    if (this.matchKw('loop_forever')) {
      const body = this.parseBlock('loop forever', startLine);
      return { kind: 'loopForever', body };
    }

    if (this.matchKw('give_back')) {
      if (this.checkKw('done') || this.isAtEnd()) {
        return { kind: 'return', value: null };
      }
      return { kind: 'return', value: this.parseExpression() };
    }

    if (this.matchKw('stop_loop')) return { kind: 'break' };
    if (this.matchKw('skip_to_next') || this.matchKw('skip_ahead')) return { kind: 'continue' };

    if (this.matchKw('stop_everything') || this.matchKw('exit_program') || this.matchKw('quit')) {
      return { kind: 'exit' };
    }

    // `x is 5` / `x be 5` — the C habit of assigning without `make`
    const t = this.peek();
    const next = this.tokens[this.pos + 1];
    if (t.kind === 'IDENT' && next.kind === 'KW' && (next.value === 'is' || next.value === 'be')) {
      throw new RuntimeErr(`to change '${t.value}' write 'make ${t.value} be …' (or declare it with 'number ${t.value} is …')`, t.line);
    }

    // The only expression that works as a statement on its own is a call
    if (this.checkKw('call')) {
      return { kind: 'exprStmt', expr: this.parseExpression() };
    }

    if (t.kind === 'IDENT') {
      const guess = closest(t.value, STATEMENT_WORDS);
      const hint = guess ? ` — did you mean '${guess}'?` : '';
      throw new RuntimeErr(`'${t.value}' isn't a command I know${hint}`, t.line);
    }
    throw new RuntimeErr(`a line can't start with ${this.describe(t)}`, t.line);
  }

  private parseIf(): StmtBody {
    const startLine = this.peek().line;
    this.expectKw('if');
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
    this.expectDone('if', startLine);
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
    let expr = this.parsePower();
    while (true) {
      if (this.matchKw('times')) {
        const right = this.parsePower();
        expr = { kind: 'binary', op: '*', left: expr, right };
      } else if (this.matchKw('divided_by')) {
        const right = this.parsePower();
        expr = { kind: 'binary', op: '/', left: expr, right };
      } else if (this.matchKw('modulo') || this.matchKw('mod')) {
        const right = this.parsePower();
        expr = { kind: 'binary', op: '%', left: expr, right };
      } else break;
    }
    return expr;
  }

  // `X to the power of Y` — right-associative, binds tighter than * /.
  // Lowered to a `pow(X, Y)` builtin call so the interpreter dispatches
  // through the same path as the prefix-style builtins.
  private parsePower(): Expr {
    const base = this.parseUnary();
    if (this.matchKw('to_the_power_of')) {
      const exp = this.parsePower();
      return { kind: 'call', name: '__builtin_pow', args: [base, exp] };
    }
    return base;
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
    if (t.kind === 'LPAREN') {
      this.advance();
      const inner = this.parseExpression();
      if (this.peek().kind !== 'RPAREN') {
        throw new RuntimeErr(`missing ')' — found ${this.describe(this.peek())} instead`, t.line);
      }
      this.advance();
      return inner;
    }
    if (t.kind === 'KW' && t.value === 'yes')  { this.advance(); return { kind: 'bool', value: true }; }
    if (t.kind === 'KW' && t.value === 'no')   { this.advance(); return { kind: 'bool', value: false }; }

    // Prefix-style math builtins: `square root of X`, `absolute value of X`,
    // `sine of X`, `cosine of X`, `tangent of X`, `logarithm of X`,
    // `rounded X`, `rounded up X`, `rounded down X`.
    const prefixBuiltins: Record<string, string> = {
      'square_root_of':    '__builtin_sqrt',
      'absolute_value_of': '__builtin_abs',
      'sine_of':           '__builtin_sin',
      'cosine_of':         '__builtin_cos',
      'tangent_of':        '__builtin_tan',
      'logarithm_of':      '__builtin_log',
      'rounded_down':      '__builtin_floor',
      'rounded_up':        '__builtin_ceil',
      'rounded':           '__builtin_round',
    };
    if (t.kind === 'KW' && t.value in prefixBuiltins) {
      const fn = prefixBuiltins[t.value];
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'call', name: fn, args: [operand] };
    }

    // Two-arg math builtins: `maximum of A and B`, `minimum of A and B`,
    // `bigger of A and B`, `smaller of A and B`.
    const twoArgBuiltins: Record<string, string> = {
      'maximum_of': '__builtin_max',
      'bigger_of':  '__builtin_max',
      'minimum_of': '__builtin_min',
      'smaller_of': '__builtin_min',
    };
    if (t.kind === 'KW' && t.value in twoArgBuiltins) {
      const fn = twoArgBuiltins[t.value];
      this.advance();
      const a = this.parseTwoArgOperand();
      this.expectKw('and');
      const b = this.parseTwoArgOperand();
      return { kind: 'call', name: fn, args: [a, b] };
    }

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
    throw new RuntimeErr(`expected a value but found ${this.describe(t)}`, t.line);
  }

  /// For `maximum of A and B` we need a tight operand that doesn't try to
  /// consume the `and` separator. parseUnary is the right shape — it can
  /// pull a literal, identifier, or nested builtin call but stops before
  /// binary operators.
  private parseTwoArgOperand(): Expr {
    return this.parseUnary();
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
      throw new RuntimeErr(`expected '${value.replace(/_/g, ' ')}' but found ${this.describe(t)}`, t.line);
    }
  }
  private expectIdent(): string {
    const t = this.peek();
    if (t.kind !== 'IDENT') {
      const why = t.kind === 'KW' ? ` ('${t.value.replace(/_/g, ' ')}' is a reserved word)` : '';
      throw new RuntimeErr(`expected a name but found ${this.describe(t)}${why}`, t.line);
    }
    this.advance();
    return t.value;
  }
  // How a token reads in an error message
  private describe(t: Token): string {
    if (t.kind === 'EOF') return 'the end of the program';
    if (t.kind === 'STRING') return 'some text';
    return `'${t.value.replace(/_/g, ' ')}'`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Interpreter
// ─────────────────────────────────────────────────────────────────────

class RuntimeErr extends Error {
  constructor(message: string, public line?: number) { super(message); }
}
class BreakSignal {}
class ContinueSignal {}
class ExitSignal {}
class ReturnSignal { constructor(public value: Value | null) {} }

const MAX_CALL_DEPTH = 500;
const MAX_OUTPUT_LINES = 10_000;

// Words a statement can start with, for "did you mean" on a typo
const STATEMENT_WORDS = [
  'show', 'say', 'display', 'print', 'tell me', 'make', 'remember',
  'increase', 'decrease', 'if', 'otherwise', 'repeat', 'count from',
  'loop forever', 'keep going while', 'give back', 'call', 'stop loop',
  'skip to next', 'quit', 'number', 'decimal', 'truth', 'talking', 'done',
];

// The candidate within two edits of `word`, if there is one
function closest(word: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDist = 3;
  for (const c of candidates) {
    const d = editDistance(word.toLowerCase(), c.toLowerCase());
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

interface Variable { value: Value; type: string | null; }

class Environment {
  private vars = new Map<string, Variable>();
  constructor(public parent: Environment | null = null) {}
  private lookup(name: string): Variable | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }
  get(name: string): Value {
    const v = this.lookup(name);
    if (v) return v.value;
    const guess = closest(name, this.names());
    const hint = guess ? ` — did you mean '${guess}'?` : ` — declare it first, e.g. 'number ${name} is 0'`;
    throw new RuntimeErr(`Unknown variable '${name}'${hint}`);
  }
  set(name: string, value: Value): void {
    const v = this.lookup(name);
    if (v) v.value = coerce(value, v.type, name);
    else this.vars.set(name, { value, type: null });
  }
  has(name: string): boolean { return this.lookup(name) !== undefined; }
  declare(name: string, value: Value, type: string | null): void {
    this.vars.set(name, { value: coerce(value, type, name), type });
  }
  names(): string[] {
    return [...this.vars.keys(), ...(this.parent ? this.parent.names() : [])];
  }
}

// Store a value the way C would for the declared type: a `number` (int)
// drops the fraction, and text can't go into a numeric variable.
function coerce(value: Value, type: string | null, name: string): Value {
  if (type === 'int' || type === 'float' || type === 'double') {
    if (typeof value === 'string') {
      throw new RuntimeErr(`'${name}' holds numbers, so it can't store text — use 'talking ${name}' for text`);
    }
    const n = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    return type === 'int' ? Math.trunc(n) : n;
  }
  return value;
}

class Interpreter {
  private functions = new Map<string, FunctionDecl>();
  private globals = new Environment();
  output: string[] = [];
  // Line of the statement being run, attached to any error it throws
  line = 0;
  private steps = 0;
  private depth = 0;
  private readonly STEP_LIMIT = 2_000_000;

  run(program: Program): void {
    for (const fn of program.functions) {
      this.functions.set(fn.name, fn);
    }
    const main = this.functions.get('main');
    if (!main && program.statements.length === 0) {
      throw new RuntimeErr("nothing to run — put your program inside 'task main does … done'", 1);
    }
    try {
      // Top-level statements (globals) run first, then main()
      for (const stmt of program.statements) this.execStmt(stmt, this.globals);
      if (main) this.callFunction(main, []);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
    }
  }

  private execBlock(stmts: Stmt[], env: Environment): void {
    for (const s of stmts) this.execStmt(s, env);
  }

  private tick(): void {
    if (++this.steps > this.STEP_LIMIT) {
      throw new RuntimeErr('the program ran too long and was stopped (is there a loop that never ends?)');
    }
  }

  private execStmt(stmt: Stmt, env: Environment): void {
    this.tick();
    this.line = stmt.line;
    switch (stmt.kind) {
      case 'varDecl': {
        const v = stmt.init ? this.evalExpr(stmt.init, env) : this.defaultValueFor(stmt.type);
        env.declare(stmt.name, v, stmt.type);
        return;
      }
      case 'assign': {
        const v = this.evalExpr(stmt.value, env);
        this.line = stmt.line;
        env.set(stmt.name, v);
        return;
      }
      case 'show': {
        const v = this.evalExpr(stmt.expr, env);
        if (this.output.length >= MAX_OUTPUT_LINES) {
          throw new RuntimeErr(`stopped after ${MAX_OUTPUT_LINES.toLocaleString('en-US')} lines of output (is there a loop that never ends?)`);
        }
        this.output.push(this.formatValue(v));
        return;
      }
      case 'if': {
        for (const b of stmt.branches) {
          this.line = stmt.line;
          if (this.truthy(this.evalExpr(b.cond, env))) {
            this.execBlock(b.body, new Environment(env));
            return;
          }
        }
        if (stmt.elseBody) this.execBlock(stmt.elseBody, new Environment(env));
        return;
      }
      case 'while': {
        while (true) {
          this.line = stmt.line;
          let condVal = this.truthy(this.evalExpr(stmt.cond, env));
          if (stmt.negated) condVal = !condVal;
          if (!condVal) break;
          if (this.runLoopBody(stmt.body, new Environment(env))) return;
        }
        return;
      }
      case 'for': {
        const loopEnv = new Environment(env);
        const startV = this.evalExpr(stmt.start, env);
        const endV = this.evalExpr(stmt.end, env);
        if (typeof startV !== 'number' || typeof endV !== 'number') {
          throw new RuntimeErr('the from and to of a loop must be numbers');
        }
        loopEnv.declare(stmt.varName, startV, 'int');
        while ((loopEnv.get(stmt.varName) as number) < endV) {
          if (this.runLoopBody(stmt.body, new Environment(loopEnv))) return;
          loopEnv.set(stmt.varName, (loopEnv.get(stmt.varName) as number) + 1);
        }
        return;
      }
      case 'repeatN': {
        const countV = this.evalExpr(stmt.count, env);
        if (typeof countV !== 'number') throw new RuntimeErr('the repeat count must be a number');
        for (let i = 0; i < countV; i++) {
          if (this.runLoopBody(stmt.body, new Environment(env))) return;
        }
        return;
      }
      case 'loopForever': {
        while (true) {
          if (this.runLoopBody(stmt.body, new Environment(env))) return;
        }
      }
      case 'return': {
        throw new ReturnSignal(stmt.value ? this.evalExpr(stmt.value, env) : null);
      }
      case 'break': throw new BreakSignal();
      case 'continue': throw new ContinueSignal();
      case 'exit': throw new ExitSignal();
      case 'exprStmt': this.evalExpr(stmt.expr, env); return;
    }
  }

  // Runs one pass of a loop body. Returns true when `stop loop` ran.
  private runLoopBody(body: Stmt[], env: Environment): boolean {
    this.tick(); // an empty `loop forever` still has to hit the limit
    try {
      this.execBlock(body, env);
    } catch (e) {
      if (e instanceof BreakSignal) return true;
      if (e instanceof ContinueSignal) return false;
      throw e;
    }
    return false;
  }

  private evalExpr(expr: Expr, env: Environment): Value {
    this.tick();
    switch (expr.kind) {
      case 'num':  return expr.value;
      case 'str':  return expr.value;
      case 'bool': return expr.value;
      case 'ident': return env.get(expr.name);
      case 'unary': {
        const v = this.evalExpr(expr.operand, env);
        if (expr.op === '~') {
          if (typeof v !== 'number') throw new RuntimeErr('bitwise not needs a number');
          return ~v;
        }
        throw new RuntimeErr(`Unknown unary operator ${expr.op}`);
      }
      case 'binary': {
        const l = this.evalExpr(expr.left, env);
        const r = this.evalExpr(expr.right, env);
        switch (expr.op) {
          case '+':
            if (typeof l === 'string' || typeof r === 'string') return this.formatValue(l) + this.formatValue(r);
            return Number(l) + Number(r);
          case '-': return Number(l) - Number(r);
          case '*': return Number(l) * Number(r);
          case '/':
            if (Number(r) === 0) throw new RuntimeErr('Division by zero');
            return Number(l) / Number(r);
          case '%':
            if (Number(r) === 0) throw new RuntimeErr('Division by zero (modulo 0)');
            return Number(l) % Number(r);
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
        const argVals = expr.args.map(a => this.evalExpr(a, env));
        // Builtins first — these don't appear in the user's `functions`
        // map but should still be callable.
        if (expr.name.startsWith('__builtin_')) {
          return this.callBuiltin(expr.name, argVals);
        }
        const fn = this.functions.get(expr.name);
        if (!fn) {
          const guess = closest(expr.name, this.functions.keys());
          const hint = guess ? ` — did you mean '${guess}'?` : '';
          throw new RuntimeErr(`there's no task called '${expr.name}'${hint}`);
        }
        if (argVals.length !== fn.params.length) {
          const takes = fn.params.length === 1 ? '1 value' : `${fn.params.length} values`;
          throw new RuntimeErr(`'${fn.name}' takes ${takes} but got ${argVals.length}`);
        }
        const callLine = this.line;
        const result = this.callFunction(fn, argVals);
        this.line = callLine;
        return result;
      }
    }
  }

  private callBuiltin(name: string, args: Value[]): Value {
    const num = (i: number) => {
      const v = args[i];
      if (typeof v !== 'number') {
        throw new RuntimeErr(`${name.replace('__builtin_', '')} needs a number, not ${this.formatValue(v)}`);
      }
      return v;
    };
    switch (name) {
      case '__builtin_sqrt':  return Math.sqrt(num(0));
      case '__builtin_abs':   return Math.abs(num(0));
      case '__builtin_sin':   return Math.sin(num(0));
      case '__builtin_cos':   return Math.cos(num(0));
      case '__builtin_tan':   return Math.tan(num(0));
      case '__builtin_log':   return Math.log(num(0));
      case '__builtin_floor': return Math.floor(num(0));
      case '__builtin_ceil':  return Math.ceil(num(0));
      case '__builtin_round': return Math.round(num(0));
      case '__builtin_pow':   return Math.pow(num(0), num(1));
      case '__builtin_max':   return Math.max(num(0), num(1));
      case '__builtin_min':   return Math.min(num(0), num(1));
    }
    throw new RuntimeErr(`Unknown builtin '${name}'`);
  }

  private callFunction(fn: FunctionDecl, args: Value[]): Value {
    if (this.depth >= MAX_CALL_DEPTH) {
      throw new RuntimeErr(`too much recursion — '${fn.name}' went ${MAX_CALL_DEPTH} calls deep without finishing`);
    }
    const fnEnv = new Environment(this.globals);
    for (let i = 0; i < fn.params.length; i++) {
      fnEnv.declare(fn.params[i].name, args[i], fn.params[i].type);
    }
    this.depth++;
    try {
      this.execBlock(fn.body, fnEnv);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        return coerce(e.value ?? 0, fn.returnType, fn.name);
      }
      throw e;
    } finally {
      this.depth--;
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

  // Numbers print like C's %g: whole numbers as-is, fractions to 6
  // significant digits (so 0.1 plus 0.2 shows 0.3)
  private formatValue(v: Value): string {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (Number.isInteger(v) || !Number.isFinite(v)) return v.toString();
      return Number(v.toPrecision(6)).toString();
    }
    return v;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export interface RunResult {
  success: boolean;
  output: string;
  error?: string;
  // Source line the error points at, when known
  line?: number;
}

export function runProgram(source: string): RunResult {
  const interp = new Interpreter();
  const outputSoFar = () => interp.output.map(o => o + '\n').join('');
  try {
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    interp.run(program);
    return { success: true, output: outputSoFar() };
  } catch (e) {
    if (e instanceof RuntimeErr) {
      const line = e.line ?? (interp.line || undefined);
      return { success: false, output: outputSoFar(), error: e.message, line };
    }
    // A deeply nested program can still exhaust the JS stack before
    // MAX_CALL_DEPTH is reached
    if (e instanceof RangeError) {
      return { success: false, output: outputSoFar(), error: 'too much recursion — the program ran out of stack', line: interp.line || undefined };
    }
    return { success: false, output: outputSoFar(), error: (e as Error).message || String(e) };
  }
}
