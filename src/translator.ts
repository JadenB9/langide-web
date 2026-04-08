// NaturalLanguageTranslator — TypeScript port of LangIDE's Swift translator.
//
// Takes natural-English source and emits an intermediate C-like form. The
// goal is not semantic correctness as C — it's to turn phrases like
//   `task main does show quotes Hello ends quote done`
// into
//   `int main() { print "Hello " }`
// so we can render "look, your English became this" without needing a
// full compiler in the browser.

export class NaturalLanguageTranslator {
  private source: string;
  private pos = 0;
  private out = '';

  constructor(source: string) {
    this.source = source;
  }

  translate(): string {
    this.pos = 0;
    this.out = '';
    while (!this.eof()) {
      this.dispatch();
    }
    return this.out;
  }

  // ─────────────────────────────────────────────────────────────────
  // Main dispatcher — try multi-word matches first, longest patterns
  // before shorter ones in each category.
  // ─────────────────────────────────────────────────────────────────
  private dispatch(): void {
    this.skipSpaces();
    if (this.eof()) return;

    // Comments
    if (this.tryTr('note:',    '//', false)) { this.copyLine(); return; }
    if (this.tryTr('comment:', '//', false)) { this.copyLine(); return; }
    if (this.tryTr('remark:',  '//', false)) { this.copyLine(); return; }

    // Types
    if (this.tryTr('precise decimal', 'double')) return;
    if (this.tryTr('talking', 'string')) {
      this.bridgeStringInitializer();
      return;
    }
    if (this.tryTr('number',  'int'))    return;
    if (this.tryTr('decimal', 'float'))  return;
    if (this.tryTr('truth',   'bool'))   return;
    if (this.tryTr('nothing', 'void'))   return;

    // Multi-word math (must beat `to`, `of`, `and`)
    if (this.tryTr('square root of', 'sqrt(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('absolute value of', 'abs(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('rounded down', 'floor(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('rounded up', 'ceil(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('rounded', 'round(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('sine of',    'sin(',  false)) { this.out += this.readOperand() + ')'; return; }
    if (this.tryTr('cosine of',  'cos(',  false)) { this.out += this.readOperand() + ')'; return; }
    if (this.tryTr('tangent of', 'tan(',  false)) { this.out += this.readOperand() + ')'; return; }
    if (this.tryTr('logarithm of', 'log(', false)) { this.out += this.readOperand() + ')'; return; }
    if (this.tryTr('to the power of', '', false)) {
      const base = this.takeLastOperandFromOutput();
      const exp = this.readOperand();
      this.out += `pow(${base}, ${exp})`;
      return;
    }
    if (this.tryTr('maximum of', '', false)) { this.emitMinMax(true);  return; }
    if (this.tryTr('minimum of', '', false)) { this.emitMinMax(false); return; }
    if (this.tryTr('bigger of',  '', false)) { this.emitMinMax(true);  return; }
    if (this.tryTr('smaller of', '', false)) { this.emitMinMax(false); return; }

    // Bitwise
    if (this.tryTr('bitwise and', '&')) return;
    if (this.tryTr('bitwise or',  '|')) return;
    if (this.tryTr('bitwise xor', '^')) return;
    if (this.tryTr('bitwise not', '~')) return;
    if (this.tryTr('shift left',  '<<')) return;
    if (this.tryTr('shift right', '>>')) return;

    // Comparison (multi-word first)
    if (this.tryTr('is equal to',     '==')) return;
    if (this.tryTr('is not equal to', '!=')) return;
    if (this.tryTr('not equals',      '!=')) return;
    if (this.tryTr('greater than or equal to', '>=')) return;
    if (this.tryTr('less than or equal to',    '<=')) return;
    if (this.tryTr('greater than', '>')) return;
    if (this.tryTr('less than',    '<')) return;
    if (this.tryTr('at least',     '>=')) return;
    if (this.tryTr('at most',      '<=')) return;
    if (this.tryTr('equals',       '==')) return;

    // Logical
    if (this.tryTr('and also', '&&')) return;
    if (this.tryTr('or else',  '||')) return;

    // Arithmetic
    if (this.tryTr('divided by', '/')) return;
    if (this.tryTr('plus',  '+')) return;
    if (this.tryTr('minus', '-')) return;
    if (this.tryTr('times', '*')) return;
    if (this.tryTr('modulo', '%')) return;
    if (this.tryTr('mod',   '%')) return;

    // Function decl
    if (this.tryTr('task', '', false)) {
      this.translateFunctionDecl();
      return;
    }

    // Return
    if (this.tryTr('give back', 'return')) return;

    // Call
    if (this.tryTr('call', '', false)) {
      this.translateFunctionCall();
      return;
    }

    // Control flow
    if (this.tryTr('repeat while', 'while (', false)) {
      this.translateCondition();
      this.tryTr('do', '{');
      return;
    }
    if (this.tryTr('keep going while', 'while (', false)) {
      this.translateCondition();
      this.tryTr('do', '{');
      return;
    }
    if (this.tryTr('repeat until', 'while (!(', false)) {
      this.translateCondition();
      if (this.out.endsWith(') ')) {
        this.out = this.out.slice(0, -1) + ') ';
      }
      this.tryTr('do', '{');
      return;
    }
    if (this.tryTr('repeat for', 'for (int ', false)) {
      this.translateForLoop();
      return;
    }
    if (this.tryTr('count from', 'for (int _c = ', false)) {
      this.skipSpaces();
      const start = this.readNumber();
      this.out += start + ' _c < ';
      this.skipSpaces();
      this.matchKeyword('to');
      this.skipSpaces();
      const end = this.readNumber();
      this.out += end + ' ; _c = _c + 1) {';
      this.skipSpaces();
      this.matchKeyword('do');
      return;
    }
    if (this.matchNumericRepeatTimes()) return;
    if (this.tryTr('loop forever do', 'while (1) {')) return;

    if (this.tryTr('or if', '} else if (', false)) {
      this.translateCondition();
      this.tryTr('then', '{');
      return;
    }
    if (this.tryTr('if', 'if (', false)) {
      this.translateCondition();
      this.tryTr('then', '{');
      return;
    }
    if (this.tryTr('otherwise', '} else {')) return;

    // Statements
    if (this.tryTr('show quotes', 'print "', false)) {
      this.translateStringBody();
      return;
    }
    if (this.tryTr('tell me',   'print')) return;
    if (this.tryTr('print out', 'print')) return;
    if (this.tryTr('display',   'print')) return;
    if (this.tryTr('say',       'print')) return;
    if (this.tryTr('show',      'print')) return;

    if (this.tryTr('remember', 'int', true)) {
      this.skipSpaces();
      const name = this.readIdentifier();
      this.out += name;
      this.skipSpaces();
      if (this.matchKeyword('as')) this.out += ' = ';
      return;
    }

    if (this.tryTr('make', '', false)) {
      this.skipSpaces();
      const rest = this.source.substring(this.pos).toLowerCase();
      if (rest.startsWith('item ')) return;
      this.translateAssignment();
      return;
    }

    if (this.tryTr('ask for', '', false)) {
      this.skipSpaces();
      const name = this.readIdentifier();
      this.out += `scanf("%d", &${name})`;
      return;
    }
    if (this.tryTr('read number into', '', false)) {
      this.skipSpaces();
      const name = this.readIdentifier();
      this.out += `scanf("%d", &${name})`;
      return;
    }

    if (this.tryTr('stop everything', 'exit(0)')) return;
    if (this.tryTr('exit program',    'exit(0)')) return;
    if (this.tryTr('quit',            'exit(0)')) return;
    if (this.tryTr('wait for', 'sleep(', false)) {
      this.skipSpaces();
      this.out += this.readNumber() + ')';
      this.skipSpaces();
      this.matchKeyword('seconds');
      this.matchKeyword('second');
      return;
    }
    if (this.tryTr('clear screen', 'system("clear")')) return;

    // Block end
    if (this.tryTr('done', '}')) return;

    if (this.tryTr('quotes', '"', false)) {
      this.translateStringBody();
      return;
    }
    if (this.tryTr('ends quote', '"')) return;

    // Booleans
    if (this.tryTr('yes', 'true')) return;
    if (this.tryTr('no',  'false')) return;

    // Random / time
    if (this.tryTr('seed random with current time', 'srand(time(NULL))')) return;
    if (this.tryTr('seed random with', 'srand(', false)) {
      this.out += this.readOperand() + ')';
      return;
    }
    if (this.tryTr('random number', 'rand()')) return;
    if (this.tryTr('current time',  'time(NULL)')) return;

    // Increment / decrement (emit explicit assignment — no postfix)
    if (this.tryTr('increase', '', false)) {
      this.skipSpaces();
      const name = this.readIdentifier();
      this.out += `${name} = ${name} + 1`;
      return;
    }
    if (this.tryTr('decrease', '', false)) {
      this.skipSpaces();
      const name = this.readIdentifier();
      this.out += `${name} = ${name} - 1`;
      return;
    }

    // Loop control
    if (this.tryTr('stop loop',    'break'))    return;
    if (this.tryTr('skip to next', 'continue')) return;
    if (this.tryTr('skip ahead',   'continue')) return;

    // Glue words
    if (this.tryTr('is',   '='))  return;
    if (this.tryTr('be',   '='))  return;
    if (this.tryTr('with', '(', false)) return;
    if (this.tryTr('and',  ', ')) return;

    // Fallback — copy a single character verbatim
    this.out += this.source[this.pos++];
  }

  // ─────────────────────────────────────────────────────────────────
  // Function declaration
  // ─────────────────────────────────────────────────────────────────
  private translateFunctionDecl(): void {
    this.skipSpaces();
    const name = this.readIdentifier();
    this.skipSpaces();

    const params: string[] = [];
    if (this.matchKeyword('taking')) {
      while (!this.eof()) {
        this.skipSpaces();
        const rest = this.source.substring(this.pos).toLowerCase();
        if (rest.startsWith('gives') || rest.startsWith('does')) break;

        let type = '';
        if (this.matchKeyword('number'))               type = 'int';
        else if (this.matchKeyword('talking'))         type = 'string';
        else if (this.matchKeyword('precise decimal')) type = 'double';
        else if (this.matchKeyword('decimal'))         type = 'float';
        else if (this.matchKeyword('truth'))           type = 'bool';
        else if (this.matchKeyword('letter'))          type = 'char';
        else break;

        this.skipSpaces();
        const paramName = this.readIdentifier();
        if (paramName) params.push(`${type} ${paramName}`);
        this.skipSpaces();
        if (!this.matchKeyword('and')) break;
      }
    }

    this.skipSpaces();
    let returnType = 'int';
    if (this.matchKeyword('gives')) {
      this.skipSpaces();
      if (this.matchKeyword('nothing'))               returnType = 'void';
      else if (this.matchKeyword('precise decimal')) returnType = 'double';
      else if (this.matchKeyword('number'))          returnType = 'int';
      else if (this.matchKeyword('decimal'))         returnType = 'float';
      else if (this.matchKeyword('talking'))         returnType = 'string';
      else if (this.matchKeyword('truth'))           returnType = 'bool';
      else if (this.matchKeyword('letter'))          returnType = 'char';
    } else if (name !== 'main') {
      returnType = 'void';
    }

    this.out += `${returnType} ${name}(${params.join(', ')}) `;
    this.skipSpaces();
    this.tryTr('does', '{');
  }

  // ─────────────────────────────────────────────────────────────────
  // Function call
  // ─────────────────────────────────────────────────────────────────
  private translateFunctionCall(): void {
    this.skipSpaces();
    const name = this.readIdentifier();
    this.out += name + '(';

    this.skipSpaces();
    if (!this.matchKeyword('with')) {
      this.out += ')';
      return;
    }

    let first = true;
    while (!this.eof()) {
      this.skipSpaces();
      if (this.shouldEndArgs()) break;
      if (!first) {
        if (this.matchKeyword('and')) {
          this.out += ', ';
          this.skipSpaces();
        } else {
          break;
        }
      }
      first = false;
      this.translateArgExpression();
    }
    this.out += ')';
  }

  private shouldEndArgs(): boolean {
    if (this.eof()) return true;
    if (this.source[this.pos] === '\n') return true;
    const rest = this.source.substring(this.pos).toLowerCase();
    return rest.startsWith('done') || rest.startsWith('then') ||
           rest.startsWith('do ') || rest.startsWith('do\n') || rest === 'do';
  }

  private translateArgExpression(): void {
    while (!this.eof()) {
      this.skipSpaces();
      if (this.shouldEndArgs()) return;

      const rest = this.source.substring(this.pos).toLowerCase();
      if (rest.startsWith('and ') || rest.startsWith('and\n')) return;

      if (this.tryTr('plus',       '+'))  continue;
      if (this.tryTr('minus',      '-'))  continue;
      if (this.tryTr('times',      '*'))  continue;
      if (this.tryTr('divided by', '/'))  continue;
      if (this.tryTr('modulo',     '%'))  continue;
      if (this.tryTr('mod',        '%'))  continue;
      if (this.tryTr('greater than', '>'))  continue;
      if (this.tryTr('less than',    '<'))  continue;
      if (this.tryTr('equals',       '==')) continue;

      if (rest.startsWith('call ')) {
        this.matchKeyword('call');
        this.translateFunctionCall();
        continue;
      }

      const c = this.source[this.pos];
      if (c === ',' || c === ')') return;
      this.out += c;
      this.pos++;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Condition
  // ─────────────────────────────────────────────────────────────────
  private translateCondition(): void {
    while (!this.eof()) {
      this.skipSpaces();
      if (this.wordBoundaryPrefix('then') || this.wordBoundaryPrefix('do')) break;

      if (this.matchKeyword('is equal to'))              { this.out += '== '; continue; }
      if (this.matchKeyword('is not equal to'))          { this.out += '!= '; continue; }
      if (this.matchKeyword('not equals'))               { this.out += '!= '; continue; }
      if (this.matchKeyword('greater than or equal to')) { this.out += '>= '; continue; }
      if (this.matchKeyword('less than or equal to'))    { this.out += '<= '; continue; }
      if (this.matchKeyword('greater than'))             { this.out += '> ';  continue; }
      if (this.matchKeyword('less than'))                { this.out += '< ';  continue; }
      if (this.matchKeyword('at least'))                 { this.out += '>= '; continue; }
      if (this.matchKeyword('at most'))                  { this.out += '<= '; continue; }
      if (this.matchKeyword('equals'))                   { this.out += '== '; continue; }
      if (this.matchKeyword('and also'))                 { this.out += '&& '; continue; }
      if (this.matchKeyword('or else'))                  { this.out += '|| '; continue; }
      if (this.matchKeyword('plus'))                     { this.out += '+ ';  continue; }
      if (this.matchKeyword('minus'))                    { this.out += '- ';  continue; }
      if (this.matchKeyword('times'))                    { this.out += '* ';  continue; }
      if (this.matchKeyword('divided by'))               { this.out += '/ ';  continue; }
      if (this.matchKeyword('modulo'))                   { this.out += '% ';  continue; }
      if (this.matchKeyword('mod'))                      { this.out += '% ';  continue; }
      if (this.matchKeyword('yes'))                      { this.out += 'true '; continue; }
      if (this.matchKeyword('no'))                       { this.out += 'false '; continue; }

      this.out += this.source[this.pos++];
    }
    if (this.out.endsWith(' ')) this.out = this.out.slice(0, -1);
    this.out += ') ';
  }

  // ─────────────────────────────────────────────────────────────────
  // Loops
  // ─────────────────────────────────────────────────────────────────
  private translateForLoop(): void {
    this.skipSpaces();
    const name = this.readIdentifier();
    this.out += name + ' ';
    this.skipSpaces();
    if (this.matchKeyword('from')) {
      this.skipSpaces();
      const start = this.readNumber();
      this.out += `= ${start} ${name} < `;
      this.skipSpaces();
      if (this.matchKeyword('to')) {
        this.skipSpaces();
        const end = this.readNumber();
        this.out += `${end} ; ${name} = ${name} + 1`;
      }
    }
    this.skipSpaces();
    if (this.matchKeyword('do')) this.out += ') {';
  }

  private matchNumericRepeatTimes(): boolean {
    const rest = this.source.substring(this.pos).toLowerCase();
    if (!rest.startsWith('repeat ')) return false;
    const afterRepeat = this.pos + 'repeat '.length;
    if (afterRepeat >= this.source.length || !/[0-9]/.test(this.source[afterRepeat])) return false;
    this.pos = afterRepeat;
    this.skipSpaces();
    const num = this.readNumber();
    this.skipSpaces();
    if (!this.matchKeyword('times')) return false;
    this.skipSpaces();
    this.matchKeyword('do');

    const varName = `_i${num}`;
    this.out += `for (int ${varName} = 0 ${varName} < ${num} ; ${varName} = ${varName} + 1) {`;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // Assignment
  // ─────────────────────────────────────────────────────────────────
  private translateAssignment(): void {
    this.skipSpaces();
    const name = this.readIdentifier();
    this.out += name + ' ';
    this.skipSpaces();
    if (this.matchKeyword('be')) this.out += '= ';
  }

  // ─────────────────────────────────────────────────────────────────
  // Min / Max
  // ─────────────────────────────────────────────────────────────────
  private emitMinMax(isMax: boolean): void {
    this.skipSpaces();
    const a = this.readOperand();
    this.skipSpaces();
    if (!this.matchKeyword('and')) {
      this.out += a;
      return;
    }
    this.skipSpaces();
    const b = this.readOperand();
    const fn = isMax ? '__lang_max' : '__lang_min';
    this.out += `${fn}(${a}, ${b})`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Strings
  // ─────────────────────────────────────────────────────────────────
  private translateStringBody(): void {
    while (!this.eof()) {
      const rest = this.source.substring(this.pos).toLowerCase();
      if (rest.startsWith('ends quote')) {
        this.out += '"';
        this.pos += 'ends quote'.length;
        return;
      }
      this.out += this.source[this.pos++];
    }
  }

  private bridgeStringInitializer(): void {
    this.skipSpaces();
    const saved = this.pos;
    const name = this.readIdentifier();
    if (!name) { this.pos = saved; return; }
    this.out += name;
    this.skipSpaces();
    if (this.wordBoundaryPrefix('quotes')) this.out += ' = ';
  }

  // ─────────────────────────────────────────────────────────────────
  // Primitive readers
  // ─────────────────────────────────────────────────────────────────
  private readIdentifier(): string {
    let r = '';
    while (!this.eof()) {
      const c = this.source[this.pos];
      if (/[A-Za-z0-9_]/.test(c)) {
        r += c;
        this.pos++;
      } else break;
    }
    return r;
  }

  private readNumber(): string {
    let r = '';
    while (!this.eof()) {
      const c = this.source[this.pos];
      if (/[0-9.]/.test(c)) {
        r += c;
        this.pos++;
      } else break;
    }
    return r;
  }

  private readOperand(): string {
    this.skipSpaces();
    let r = '';
    if (!this.eof() && this.source[this.pos] === '-') {
      r += '-';
      this.pos++;
    }
    if (!this.eof() && this.source[this.pos] === '(') {
      let depth = 0;
      while (!this.eof()) {
        const c = this.source[this.pos++];
        r += c;
        if (c === '(') depth++;
        if (c === ')') {
          depth--;
          if (depth === 0) return r;
        }
      }
      return r;
    }
    while (!this.eof()) {
      const c = this.source[this.pos];
      if (/[A-Za-z0-9_.]/.test(c)) {
        r += c;
        this.pos++;
      } else break;
    }
    return r;
  }

  private takeLastOperandFromOutput(): string {
    let t = this.out;
    while (t.endsWith(' ')) t = t.slice(0, -1);
    if (t.endsWith(')')) {
      let depth = 0;
      let i = t.length - 1;
      while (i >= 0) {
        const c = t[i];
        if (c === ')') depth++;
        if (c === '(') {
          depth--;
          if (depth === 0) break;
        }
        i--;
      }
      const operand = t.substring(i);
      this.out = t.substring(0, i);
      return operand;
    }
    let i = t.length;
    while (i > 0) {
      const c = t[i - 1];
      if (/[A-Za-z0-9_.]/.test(c)) i--;
      else break;
    }
    const operand = t.substring(i);
    this.out = t.substring(0, i);
    return operand;
  }

  // ─────────────────────────────────────────────────────────────────
  // Whitespace / boundaries
  // ─────────────────────────────────────────────────────────────────
  private copyLine(): void {
    while (!this.eof()) {
      const c = this.source[this.pos++];
      this.out += c;
      if (c === '\n') return;
    }
  }

  private skipSpaces(): void {
    while (!this.eof()) {
      const c = this.source[this.pos];
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else break;
    }
  }

  private eof(): boolean { return this.pos >= this.source.length; }

  private wordBoundaryPrefix(keyword: string): boolean {
    const rest = this.source.substring(this.pos).toLowerCase();
    if (!rest.startsWith(keyword.toLowerCase())) return false;
    const endIdx = this.pos + keyword.length;
    if (endIdx < this.source.length) {
      const next = this.source[endIdx];
      if (/[A-Za-z0-9_]/.test(next)) return false;
    }
    return true;
  }

  private matchKeyword(keyword: string): boolean {
    if (!this.wordBoundaryPrefix(keyword)) return false;
    this.pos += keyword.length;
    this.skipSpaces();
    return true;
  }

  private tryTr(keyword: string, replacement: string, trailingSpace = true): boolean {
    if (!this.wordBoundaryPrefix(keyword)) return false;
    this.out += replacement;
    if (trailingSpace && replacement.length > 0) this.out += ' ';
    this.pos += keyword.length;
    this.skipSpaces();
    return true;
  }
}
