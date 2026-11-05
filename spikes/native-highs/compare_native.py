# Native HiGHS probe (RUK-563): re-solve the solves highs-js 1.15.3 (HiGHS 1.15.1, WASM) made, dumped by dump-solves.patch, with highspy 1.15.1 (native), and compare every bit.
import json, glob, struct, sys, time
import numpy as np
import highspy
EXTRA = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

def dec(v):
    if isinstance(v, str):
        return {'Infinity': float('inf'), '-Infinity': float('-inf'), 'NaN': float('nan'), '-0': -0.0}[v]
    return v
def arr(a, dtype=float):
    return np.array([dec(x) for x in a], dtype=dtype)
def bits(x):
    return struct.pack('<d', float(x))

STATUS = {highspy.HighsModelStatus.kOptimal: 'optimal', highspy.HighsModelStatus.kInfeasible: 'infeasible',
          highspy.HighsModelStatus.kUnbounded: 'unbounded', highspy.HighsModelStatus.kUnboundedOrInfeasible: 'unbounded'}
stats = {'lp': [0, 0, 0], 'mip': [0, 0, 0]}  # compared, identical, skipped
wasm_ms = {'lp': 0.0, 'mip': 0.0}; native_ms = {'lp': 0.0, 'mip': 0.0}
first_diffs = []
for f in sorted(glob.glob(sys.argv[1] + '/solves-*.jsonl')):
    for line in open(f):
        d = json.loads(line)
        kind = 'mip' if d['integer'] is not None else 'lp'
        if d['maxIterations'] is not None or d['stopOnRootLpFailure']:
            stats[kind][2] += 1
            continue
        h = highspy.Highs()
        h.setOptionValue("output_flag", False)
        for k, v in EXTRA.items(): h.setOptionValue(k, v)
        lp = highspy.HighsLp()
        lp.num_col_ = d['numCols']; lp.num_row_ = d['numRows']
        lp.sense_ = highspy.ObjSense.kMaximize if d['sense'] == 'max' else highspy.ObjSense.kMinimize
        lp.col_cost_ = arr(d['colCost']); lp.col_lower_ = arr(d['colLower']); lp.col_upper_ = arr(d['colUpper'])
        lp.row_lower_ = arr(d['rowLower']); lp.row_upper_ = arr(d['rowUpper'])
        lp.a_matrix_.format_ = highspy.MatrixFormat.kColwise
        lp.a_matrix_.start_ = arr(d['starts'], np.int32); lp.a_matrix_.index_ = arr(d['indices'], np.int32); lp.a_matrix_.value_ = arr(d['values'])
        if d['integer'] is not None:
            lp.integrality_ = [highspy.HighsVarType.kInteger if w else highspy.HighsVarType.kContinuous for w in d['integer']]
        h.passModel(lp)
        for k, v in d['options'].items():
            h.setOptionValue(k, dec(v) if not isinstance(v, bool) else v)
        if d['start'] is not None:
            sol = highspy.HighsSolution(); sol.col_value = [dec(x) for x in d["start"]]; sol.value_valid = True
            try: h.setSolution(sol)
            except Exception: pass
        improving = []
        if d['keepImproving']:
            h.cbMipImprovingSolution.subscribe(lambda e: improving.append(list(e.data_out.mip_solution)))
        t = time.perf_counter(); h.run(); native_ms[kind] += (time.perf_counter() - t) * 1000
        wasm_ms[kind] += d['ms']
        st = h.getModelStatus(); r = d['result']
        status = STATUS.get(st)
        if status is None and d['integer'] is not None and h.getInfo().primal_solution_status == 2: status = 'feasible'
        if status is None: status = 'error'
        same = status == r['status']
        if same and status in ('optimal', 'feasible'):
            x = list(h.getSolution().col_value)
            rx = [dec(v) for v in r['x']]
            same = bits(h.getInfo().objective_function_value) == bits(dec(r['objective'])) and len(x) == len(rx) and all(bits(a) == bits(b) or (a == 0 and b == 0) for a, b in zip(x, rx))
            if not same and len(first_diffs) < 6:
                nd = sum(1 for a, b in zip(x, rx) if not (bits(a) == bits(b) or (a == 0 and b == 0)))
                first_diffs.append((kind, d['numCols'], d['numRows'], status, repr(h.getInfo().objective_function_value), repr(dec(r['objective'])), nd))
        elif not same and len(first_diffs) < 6:
            first_diffs.append((kind, d['numCols'], d['numRows'], 'status', status, r['status']))
        stats[kind][0] += 1; stats[kind][1] += int(same)
print('compared, identical, skipped (iteration cap / root-LP stop):', stats)
print('solve ms  wasm:', {k: round(v) for k, v in wasm_ms.items()}, ' native:', {k: round(v) for k, v in native_ms.items()})
for x in first_diffs: print('diff', x)
