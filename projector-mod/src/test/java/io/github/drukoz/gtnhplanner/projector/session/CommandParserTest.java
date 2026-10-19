package io.github.drukoz.gtnhplanner.projector.session;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class CommandParserTest {
    private static Command p(String... a) throws CommandException { return CommandParser.parse(a); }
    private static String err(String... a) { return assertThrows(CommandException.class, () -> CommandParser.parse(a)).getMessage(); }

    @Test void parsesEverySubcommand() throws Exception {
        Command c = p("load", "Pr0jectAb1", "gpt_abc");
        assertEquals(Command.Kind.LOAD, c.kind); assertEquals("Pr0jectAb1", c.projectId); assertEquals("gpt_abc", c.token);
        assertNull(p("LOAD", "P1").token);
        assertEquals(Integer.valueOf(65), p("layer", "65").layer);
        assertEquals(Command.Kind.LAYER, p("layer", "all").kind); assertNull(p("layer", "all").layer);
        assertEquals("next", p("step", "next").step); assertEquals("3", p("step", "3").step);
        assertEquals(Command.Kind.HELP, p().kind); assertEquals(Command.Kind.RELOAD, p("reload").kind);
        assertEquals(Boolean.FALSE, p("xray", "off").on); assertNull(p("xray").on);
        assertEquals("auto", p("url", "auto").url);
    }

    @Test void explainsMistakes() {
        assertEquals("That does not look like a planner token (they start with gpt_)", err("load", "P1", "abc"));
        assertEquals("That does not look like a project id: ../x", err("load", "../x"));
        assertEquals("Layer must be a number from 0 to 255, or all", err("layer", "300"));
        assertEquals("Step must be a number, all or next", err("step", "0"));
        assertEquals("Usage: /planner load <project> [token]", err("load"));
        assertEquals("Unknown /planner command \"fly\". Usage: " + CommandParser.USAGE, err("fly"));
    }

    // Beyond the brief: each sub-command's usage line, the ends of the ranges, keywords in any case, doubled spaces.

    @Test void givesEachSubcommandItsOwnUsageLine() {
        assertEquals("Usage: /planner load <project> [token]", err("load", "P1", "gpt_abc", "more"));
        assertEquals("Usage: /planner layer <y|all>", err("layer"));
        assertEquals("Usage: /planner step <n|all|next>", err("step", "1", "2"));
        assertEquals("Usage: /planner url <url|auto>", err("url"));
        assertEquals("Usage: /planner xray [on|off]", err("xray", "on", "off"));
        assertEquals("Usage: /planner xray [on|off]", err("xray", "maybe"));
        assertEquals("Usage: /planner clear", err("clear", "all"));
        assertEquals("Usage: /planner reload", err("reload", "now"));
    }

    @Test void readsNumbersInRangeAndKeywordsInAnyCase() throws Exception {
        assertEquals(Integer.valueOf(0), p("layer", "0").layer); assertEquals(Integer.valueOf(255), p("layer", "255").layer);
        assertEquals("Layer must be a number from 0 to 255, or all", err("layer", "-1"));
        assertEquals("Layer must be a number from 0 to 255, or all", err("layer", "top"));
        assertEquals("Step must be a number, all or next", err("step", "soon"));
        assertEquals("3", p("step", "03").step);
        assertNull(p("Layer", "ALL").layer);
        assertEquals("next", p("STEP", "Next").step); assertEquals("all", p("step", "All").step);
        assertEquals("auto", p("url", "AUTO").url); assertEquals("planner.example.org:9000", p("url", "planner.example.org:9000").url);
        assertEquals(Boolean.TRUE, p("Xray", "ON").on);
        String forty = "abcdefghij-ABCDEFGHIJ_0123456789abcdefgh";
        assertEquals(forty, p("load", forty).projectId);
        assertEquals("That does not look like a project id: " + forty + "x", err("load", forty + "x"));
        assertEquals(Command.Kind.HELP, p("help", "load").kind);
        assertEquals("P1", p("", "load", "", "P1").projectId);              // "/planner  load  P1": Minecraft splits on single spaces
    }
}
