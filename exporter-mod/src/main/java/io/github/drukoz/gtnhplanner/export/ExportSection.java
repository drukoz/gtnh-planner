package io.github.drukoz.gtnhplanner.export;

/**
 * One part of the export, run in the order of {@link Exporter#sections()}. A section writes its files through
 * {@link ExportContext#jsonl(String)} (counted) or {@link ExportContext#gzipJson(String)} (not counted) and interns
 * every item it mentions in {@link ExportContext#items()}; items, the manifest and the markers are written after the
 * last section.
 */
public interface ExportSection {

    /**
     * Stable name: the key in {@code sectionMillis}, {@code failedSections} and {@code skippedSections}, and what
     * {@code -Dgtnhplanner.skipSections} matches.
     */
    String name();

    /** Writes this section's files. One bad element must not abort the section: catch it and {@code ctx.warn}. */
    void export(ExportContext ctx) throws Exception;

    /**
     * A required section that throws fails the whole export ({@code EXPORT_FAILED}); an optional one is recorded in
     * {@code failedSections} with a warning and the export goes on.
     */
    default boolean optional() {
        return false;
    }
}
