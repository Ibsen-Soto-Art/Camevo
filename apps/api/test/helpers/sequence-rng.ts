import { RandomSource } from "../../src/engine/organism/genome";

/** RNG de prueba que reproduce una secuencia fija de valores en [0,1). */
export function sequenceRng(values: readonly number[]): RandomSource {
  let i = 0;
  return () => {
    const value = values[i % values.length] as number;
    i += 1;
    return value;
  };
}
