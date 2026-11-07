// Whether two answers of the server are the same (RUK-529, performance review F6): the server answers the same plan or
// layout with the same JSON, key for key, so equal JSON texts mean the same answer. A refetch that brings the same
// answer then keeps the object already shown, and nothing that depends on it is worked out again. Each object's text is
// made once and kept while the object lives.

const TEXTS = new WeakMap<object, string>();

function textOf(value: object): string {
  let text = TEXTS.get(value);
  if (text === undefined) {
    text = JSON.stringify(value);
    TEXTS.set(value, text);
  }
  return text;
}

/** Whether `a` and `b` are the same object, or equal as JSON (the same answer of the server). */
export function sameJson(a: object, b: object): boolean {
  return a === b || textOf(a) === textOf(b);
}
