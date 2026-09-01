export function bitwiseNot(input: number): number {
  return ~input >>> 0;
}

export function bitwiseAnd(a: number, b: number): number {
  return (a & b) >>> 0;
}

export function bitwiseOr(a: number, b: number): number {
  return (a | b) >>> 0;
}
