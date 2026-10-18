package io.github.drukoz.gtnhplanner.export.textures;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.IntInsnNode;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.LookupSwitchInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TableSwitchInsnNode;
import org.objectweb.asm.tree.VarInsnNode;

/**
 * Which icon container a block's {@code getIcon(side, meta)} returns, read from the raw class file (research §3.7
 * option 2). The method is client-only, so a dedicated server strips it from the loaded class, but the class file in
 * the jar still has it.
 *
 * <p>
 * For every (meta, side) a tiny interpreter runs the method from its first instruction with local 1 = side and
 * local 2 = meta. It knows int constants and arithmetic, locals it has stored, static icon-container fields and static
 * arrays of them indexed by an int, the container's {@code getIcon()}, branches and switches on ints, and
 * {@code ARETURN}. Anything else (another call, an instance field, an object allocation, a throw, a branch on a value
 * it does not know, more than 1,000 steps) gives up on that (meta, side).
 */
public final class CasingIconParser {

    public static final String SRG_NAME = "func_149691_a", DEV_NAME = "getIcon",
        DESC = "(II)Lnet/minecraft/util/IIcon;";

    private static final int METAS = 16, SIDES = 6, MAX_STEPS = 1000;

    /** {@code IIconContainer.getIcon()} (or a container class's own {@code getIcon()}), followed through. */
    private static final String CONTAINER_GET_ICON = "()Lnet/minecraft/util/IIcon;";

    /** A stack or local value the interpreter does not know ({@code this}, an object, a long, …). */
    private static final Object UNKNOWN = new Object();

    /** A static array field of icon containers, not yet indexed. */
    private static final class StaticArray {

        final String owner, field;

        StaticArray(String owner, String field) {
            this.owner = owner;
            this.field = field;
        }
    }

    private CasingIconParser() {}

    /**
     * result[meta][side] for meta 0..15, side 0..5; an entry is null where the method cannot be followed. Null when
     * the class does not declare the method (or {@code classBytes} is null: no class file was found).
     */
    public static IconRef[][] parse(byte[] classBytes) {
        if (classBytes == null) return null;
        MethodNode method = getIcon(classBytes);
        if (method == null) return null;
        IconRef[][] result = new IconRef[METAS][SIDES];
        for (int meta = 0; meta < METAS; meta++) {
            for (int side = 0; side < SIDES; side++) result[meta][side] = follow(method, side, meta);
        }
        return result;
    }

    /** The non-static {@code getIcon(int side, int meta)} the class declares, by SRG or dev name; else null. */
    private static MethodNode getIcon(byte[] classBytes) {
        ClassNode node = new ClassNode();
        new ClassReader(classBytes).accept(node, ClassReader.SKIP_FRAMES | ClassReader.SKIP_DEBUG);
        for (MethodNode m : node.methods) {
            if ((m.access & Opcodes.ACC_STATIC) == 0 && (SRG_NAME.equals(m.name) || DEV_NAME.equals(m.name))
                && DESC.equals(m.desc)) return m;
        }
        return null;
    }

    /**
     * Runs the method for one (side, meta). Stack values: {@link Integer} (a known int), {@link IconRef} (a static
     * container field or array element), {@link StaticArray}, or {@link #UNKNOWN}. Returns the returned
     * {@link IconRef}, or null where the method cannot be followed.
     */
    private static IconRef follow(MethodNode method, int side, int meta) {
        Object[] locals = new Object[Math.max(method.maxLocals, 3)];
        Arrays.fill(locals, UNKNOWN);
        locals[1] = side;
        locals[2] = meta;
        Deque<Object> stack = new ArrayDeque<>();
        AbstractInsnNode insn = method.instructions.getFirst();
        int steps = 0;
        while (insn != null) {
            int op = insn.getOpcode();
            if (op < 0) { // label, line number, frame
                insn = insn.getNext();
                continue;
            }
            if (++steps > MAX_STEPS) return null;
            switch (op) {
                case Opcodes.NOP:
                case Opcodes.CHECKCAST:
                    break;
                case Opcodes.DUP: {
                    Object top = stack.peek();
                    if (top == null) return null;
                    stack.push(top);
                    break;
                }
                case Opcodes.POP:
                    if (stack.poll() == null) return null;
                    break;
                case Opcodes.ICONST_M1:
                case Opcodes.ICONST_0:
                case Opcodes.ICONST_1:
                case Opcodes.ICONST_2:
                case Opcodes.ICONST_3:
                case Opcodes.ICONST_4:
                case Opcodes.ICONST_5:
                    stack.push(op - Opcodes.ICONST_0);
                    break;
                case Opcodes.BIPUSH:
                case Opcodes.SIPUSH:
                    stack.push(((IntInsnNode) insn).operand);
                    break;
                case Opcodes.LDC: {
                    Object cst = ((LdcInsnNode) insn).cst;
                    if (!(cst instanceof Integer)) return null;
                    stack.push(cst);
                    break;
                }
                // A reference local is UNKNOWN (this, or never stored) unless an ASTORE put a value there: GT's
                // BlockCasings5 keeps the chosen container in a local before calling getIcon() on it.
                case Opcodes.ILOAD:
                case Opcodes.ALOAD: {
                    int var = ((VarInsnNode) insn).var;
                    if (var >= locals.length) return null;
                    stack.push(locals[var]);
                    break;
                }
                case Opcodes.ISTORE:
                case Opcodes.ASTORE: {
                    int var = ((VarInsnNode) insn).var;
                    Object value = stack.poll();
                    if (value == null || var >= locals.length) return null;
                    locals[var] = value;
                    break;
                }
                case Opcodes.LLOAD:
                case Opcodes.FLOAD:
                case Opcodes.DLOAD:
                    stack.push(UNKNOWN);
                    break;
                case Opcodes.IADD:
                case Opcodes.ISUB:
                case Opcodes.IMUL:
                case Opcodes.IDIV:
                case Opcodes.IREM:
                case Opcodes.IAND:
                case Opcodes.IOR:
                case Opcodes.ISHL:
                case Opcodes.ISHR: {
                    Object b = stack.poll(), a = stack.poll();
                    if (!(a instanceof Integer) || !(b instanceof Integer)) return null;
                    Integer value = arithmetic(op, (Integer) a, (Integer) b);
                    if (value == null) return null;
                    stack.push(value);
                    break;
                }
                case Opcodes.GETSTATIC: {
                    FieldInsnNode f = (FieldInsnNode) insn;
                    if (f.desc.startsWith("L")) stack.push(new IconRef(f.owner, f.name, -1));
                    else if (f.desc.startsWith("[L")) stack.push(new StaticArray(f.owner, f.name));
                    else return null;
                    break;
                }
                case Opcodes.AALOAD: {
                    Object index = stack.poll(), array = stack.poll();
                    if (!(index instanceof Integer) || !(array instanceof StaticArray)) return null;
                    int i = (Integer) index;
                    if (i < 0) return null; // the JVM throws; -1 would also read as a plain field
                    StaticArray a = (StaticArray) array;
                    stack.push(new IconRef(a.owner, a.field, i));
                    break;
                }
                case Opcodes.INVOKEVIRTUAL:
                case Opcodes.INVOKEINTERFACE:
                    // The container's getIcon() keeps the container on the stack: the IconRef stands for its icon.
                    if (!CONTAINER_GET_ICON.equals(((MethodInsnNode) insn).desc)) return null;
                    if (!(stack.peek() instanceof IconRef)) return null;
                    break;
                case Opcodes.IFEQ:
                case Opcodes.IFNE:
                case Opcodes.IFLT:
                case Opcodes.IFGE:
                case Opcodes.IFGT:
                case Opcodes.IFLE: {
                    Object a = stack.poll();
                    if (!(a instanceof Integer)) return null;
                    if (holds(op, (Integer) a, 0)) {
                        insn = ((JumpInsnNode) insn).label;
                        continue;
                    }
                    break;
                }
                case Opcodes.IF_ICMPEQ:
                case Opcodes.IF_ICMPNE:
                case Opcodes.IF_ICMPLT:
                case Opcodes.IF_ICMPGE:
                case Opcodes.IF_ICMPGT:
                case Opcodes.IF_ICMPLE: {
                    Object b = stack.poll(), a = stack.poll();
                    if (!(a instanceof Integer) || !(b instanceof Integer)) return null;
                    if (holds(op - (Opcodes.IF_ICMPEQ - Opcodes.IFEQ), (Integer) a, (Integer) b)) {
                        insn = ((JumpInsnNode) insn).label;
                        continue;
                    }
                    break;
                }
                case Opcodes.GOTO:
                    insn = ((JumpInsnNode) insn).label;
                    continue;
                case Opcodes.TABLESWITCH: {
                    Object key = stack.poll();
                    if (!(key instanceof Integer)) return null;
                    int k = (Integer) key;
                    TableSwitchInsnNode t = (TableSwitchInsnNode) insn;
                    insn = k >= t.min && k <= t.max ? t.labels.get(k - t.min) : t.dflt;
                    continue;
                }
                case Opcodes.LOOKUPSWITCH: {
                    Object key = stack.poll();
                    if (!(key instanceof Integer)) return null;
                    LookupSwitchInsnNode l = (LookupSwitchInsnNode) insn;
                    int i = l.keys.indexOf(key);
                    insn = i >= 0 ? l.labels.get(i) : l.dflt;
                    continue;
                }
                case Opcodes.ARETURN: {
                    Object value = stack.poll();
                    return value instanceof IconRef ? (IconRef) value : null;
                }
                default:
                    return null;
            }
            insn = insn.getNext();
        }
        return null; // fell off the end
    }

    /** {@code a op b} for an int arithmetic opcode; null for a division by zero. */
    private static Integer arithmetic(int op, int a, int b) {
        switch (op) {
            case Opcodes.IADD:
                return a + b;
            case Opcodes.ISUB:
                return a - b;
            case Opcodes.IMUL:
                return a * b;
            case Opcodes.IDIV:
                return b == 0 ? null : a / b;
            case Opcodes.IREM:
                return b == 0 ? null : a % b;
            case Opcodes.IAND:
                return a & b;
            case Opcodes.IOR:
                return a | b;
            case Opcodes.ISHL:
                return a << b;
            case Opcodes.ISHR:
                return a >> b;
            default:
                throw new IllegalArgumentException("not an int arithmetic opcode: " + op);
        }
    }

    /** Whether the condition of {@code IFEQ … IFLE} holds for {@code a} against {@code b}. */
    private static boolean holds(int ifOp, int a, int b) {
        switch (ifOp) {
            case Opcodes.IFEQ:
                return a == b;
            case Opcodes.IFNE:
                return a != b;
            case Opcodes.IFLT:
                return a < b;
            case Opcodes.IFGE:
                return a >= b;
            case Opcodes.IFGT:
                return a > b;
            case Opcodes.IFLE:
                return a <= b;
            default:
                throw new IllegalArgumentException("not an IFxx opcode: " + ifOp);
        }
    }
}
