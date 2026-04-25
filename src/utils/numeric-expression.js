const TOKEN_RX = /\s*(\d+(?:\.\d+)?|\.\d+|[()+\-*/])/y;
const SAFE_TEXT_RX = /^[\d+\-*/().\s]+$/;

function tokenize(expression) {
  const source = String(expression ?? "").trim();
  if (!source || !SAFE_TEXT_RX.test(source)) return null;

  const tokens = [];
  let index = 0;
  while (index < source.length) {
    TOKEN_RX.lastIndex = index;
    const match = TOKEN_RX.exec(source);
    if (!match) return null;
    tokens.push(match[1]);
    index = TOKEN_RX.lastIndex;
  }
  return tokens;
}

function parse(tokens = []) {
  let index = 0;

  function peek() {
    return tokens[index] ?? null;
  }

  function consume(expected = null) {
    const token = tokens[index] ?? null;
    if (expected != null && token !== expected) return null;
    index += 1;
    return token;
  }

  function parsePrimary() {
    const token = peek();
    if (token == null) return null;
    if (token === "(") {
      consume("(");
      const value = parseExpression();
      if (value == null || consume(")") == null) return null;
      return value;
    }
    const number = Number(token);
    if (!Number.isFinite(number)) return null;
    consume();
    return number;
  }

  function parseUnary() {
    const token = peek();
    if (token === "+") {
      consume("+");
      return parseUnary();
    }
    if (token === "-") {
      consume("-");
      const value = parseUnary();
      return value == null ? null : -value;
    }
    return parsePrimary();
  }

  function parseTerm() {
    let value = parseUnary();
    if (value == null) return null;
    while (true) {
      const operator = peek();
      if (operator !== "*" && operator !== "/") break;
      consume();
      const rhs = parseUnary();
      if (rhs == null) return null;
      if (operator === "*") value *= rhs;
      else {
        if (rhs === 0) return null;
        value /= rhs;
      }
    }
    return Number.isFinite(value) ? value : null;
  }

  function parseExpression() {
    let value = parseTerm();
    if (value == null) return null;
    while (true) {
      const operator = peek();
      if (operator !== "+" && operator !== "-") break;
      consume();
      const rhs = parseTerm();
      if (rhs == null) return null;
      value = operator === "+" ? value + rhs : value - rhs;
    }
    return Number.isFinite(value) ? value : null;
  }

  const result = parseExpression();
  return index === tokens.length ? result : null;
}

export function evaluateNumericExpression(expression) {
  const tokens = tokenize(expression);
  if (!tokens?.length) return null;
  const value = parse(tokens);
  return Number.isFinite(value) ? value : null;
}
