// Example programs — mirrors LangIDE.app's built-in example dropdown so
// users see the same starter content on the web and on the desktop.

export interface Example {
  name: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    name: 'Hello World',
    code: `task main does
  show quotes Hello, World ends quote
done`,
  },
  {
    name: 'Variables & Math',
    code: `task main does
  number x is 10
  number y is 20
  number sum is x plus y
  show quotes The sum is ends quote
  show sum
done`,
  },
  {
    name: 'If / Else',
    code: `task main does
  number age is 25

  if age greater than 18 then
    show quotes You are an adult ends quote
  otherwise
    show quotes You are a minor ends quote
  done
done`,
  },
  {
    name: 'While Loop',
    code: `task main does
  number count is 0

  repeat while count less than 5 do
    show count
    make count be count plus 1
  done
done`,
  },
  {
    name: 'For Loop',
    code: `task main does
  repeat for i from 0 to 5 do
    show i
  done
done`,
  },
  {
    name: 'Custom Function',
    code: `task add taking number a and number b gives number does
  give back a plus b
done

task main does
  number answer is call add with 5 and 10
  show quotes Sum of 5 and 10: ends quote
  show answer
done`,
  },
  {
    name: 'Repeat N Times',
    code: `task main does
  show quotes Counting: ends quote
  repeat 5 times do
    show quotes hi ends quote
  done
done`,
  },
  {
    name: 'Count From / To',
    code: `task main does
  count from 1 to 5 do
    show quotes tick ends quote
  done
done`,
  },
  {
    name: 'Bitwise Operations',
    code: `task main does
  number a is 12
  number b is 5

  number andResult is a bitwise and b
  number orResult is a bitwise or b
  number xorResult is a bitwise xor b

  show quotes AND: ends quote
  show andResult
  show quotes OR: ends quote
  show orResult
  show quotes XOR: ends quote
  show xorResult
done`,
  },
  {
    name: 'Friendly Aliases',
    code: `task main does
  remember score as 42
  tell me score
  say quotes welcome ends quote
  display score
done`,
  },
  {
    name: 'Math Functions',
    code: `task main does
  show quotes square root of 16: ends quote
  show square root of 16

  show quotes 2 to the power of 8: ends quote
  show 2 to the power of 8

  show quotes absolute value of -42: ends quote
  show absolute value of -42

  show quotes rounded 3.7: ends quote
  show rounded 3.7

  show quotes bigger of 5 and 9: ends quote
  show bigger of 5 and 9
done`,
  },
  {
    name: 'Recursion (Factorial)',
    code: `task factorial taking number n gives number does
  if n at most 1 then
    give back 1
  otherwise
    number smaller is call factorial with n minus 1
    give back n times smaller
  done
done

task main does
  number answer is call factorial with 5
  show quotes 5! = ends quote
  show answer
done`,
  },
];
