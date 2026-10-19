package io.github.drukoz.gtnhplanner.projector.session;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Reads the words after {@code /planner} into a {@link Command}, or says in plain words what is wrong with them. The
 * sub-command and the words {@code all}, {@code next}, {@code auto}, {@code on} and {@code off} may be typed in any
 * case. Empty words are skipped: Minecraft splits the chat line on single spaces, so a doubled space makes one.
 */
public final class CommandParser {

    public static final String USAGE = "/planner load <project> [token] | clear | layer <y|all> | step <n|all|next> | reload | url <url|auto> | xray [on|off]";

    /** For a step that is not a number from 1, {@code all} or {@code next}; the session says the same. */
    static final String BAD_STEP = "Step must be a number, all or next";

    private static final Pattern PROJECT_ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final String TOKEN_PREFIX = "gpt_";

    private CommandParser() {}

    /**
     * No words or {@code help} (whatever follows it): HELP. Otherwise {@code load <project> [token]}, {@code clear},
     * {@code layer <y|all>}, {@code step <n|all|next>}, {@code reload}, {@code url <url|auto>} or
     * {@code xray [on|off]}. A layer is 0 to 255 and a step number at least 1; {@code all}, {@code next} and
     * {@code auto} reach the command in lower case and a step number in plain digits ({@code 03} becomes {@code 3}).
     *
     * @throws CommandException {@code Usage: /planner <that sub-command's form>} for a wrong number of words (or an
     *                          xray word other than on and off), a sentence about the project id, token, layer or step
     *                          that is not one, and {@code Unknown /planner command "<x>". Usage: <USAGE>}
     */
    public static Command parse(String[] args) throws CommandException {
        List<String> words = words(args);
        if (words.isEmpty()) return Command.help();
        String typed = words.get(0);
        List<String> rest = words.subList(1, words.size());
        switch (typed.toLowerCase(Locale.ROOT)) {
            case "help":
                return Command.help();
            case "load":
                return load(rest);
            case "clear":
                count(rest, 0, 0, "clear");
                return Command.clear();
            case "layer":
                return Command.layer(layer(only(rest, "layer <y|all>")));
            case "step":
                return Command.step(step(only(rest, "step <n|all|next>")));
            case "reload":
                count(rest, 0, 0, "reload");
                return Command.reload();
            case "url":
                String url = only(rest, "url <url|auto>");
                return Command.url(url.equalsIgnoreCase("auto") ? "auto" : url);
            case "xray":
                return Command.xray(xray(rest));
            default:
                throw new CommandException("Unknown /planner command \"" + typed + "\". Usage: " + USAGE);
        }
    }

    /** The words that are not blank, trimmed. */
    private static List<String> words(String[] args) {
        List<String> words = new ArrayList<>();
        if (args == null) return words;
        for (String a : args) {
            if (a != null && !a.trim().isEmpty()) words.add(a.trim());
        }
        return words;
    }

    /** Refuses unless there are {@code min} to {@code max} words after the sub-command, whose form is {@code form}. */
    private static void count(List<String> args, int min, int max, String form) throws CommandException {
        if (args.size() < min || args.size() > max) throw usage(form);
    }

    /** The one word after the sub-command. */
    private static String only(List<String> args, String form) throws CommandException {
        count(args, 1, 1, form);
        return args.get(0);
    }

    private static CommandException usage(String form) {
        return new CommandException("Usage: /planner " + form);
    }

    private static Command load(List<String> args) throws CommandException {
        count(args, 1, 2, "load <project> [token]");
        String projectId = args.get(0);
        if (!PROJECT_ID.matcher(projectId).matches()) {
            throw new CommandException("That does not look like a project id: " + projectId);
        }
        String token = args.size() == 2 ? args.get(1) : null;
        if (token != null && !token.startsWith(TOKEN_PREFIX)) {
            throw new CommandException("That does not look like a planner token (they start with gpt_)");
        }
        return Command.load(projectId, token);
    }

    /** {@code all} gives null (every layer), else a number from 0 to 255. */
    private static Integer layer(String word) throws CommandException {
        if (word.equalsIgnoreCase("all")) return null;
        Integer y = number(word);
        if (y == null || y < 0 || y > 255) throw new CommandException("Layer must be a number from 0 to 255, or all");
        return y;
    }

    /** {@code all} or {@code next}, else a number from 1 in plain digits. */
    private static String step(String word) throws CommandException {
        if (word.equalsIgnoreCase("all") || word.equalsIgnoreCase("next")) return word.toLowerCase(Locale.ROOT);
        Integer n = number(word);
        if (n == null || n < 1) throw new CommandException(BAD_STEP);
        return Integer.toString(n);
    }

    /** Null (switch over) without a word, else {@code on} or {@code off}. */
    private static Boolean xray(List<String> args) throws CommandException {
        count(args, 0, 1, "xray [on|off]");
        if (args.isEmpty()) return null;
        String word = args.get(0);
        if (word.equalsIgnoreCase("on")) return Boolean.TRUE;
        if (word.equalsIgnoreCase("off")) return Boolean.FALSE;
        throw usage("xray [on|off]");
    }

    /** The whole number the word spells, or null. */
    private static Integer number(String word) {
        try {
            return Integer.valueOf(word);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
