package dev.chronoly.core.quest;

/**
 * One line of the fragment corpus.
 *
 * @param slot     which element this line refers to, or null for a closing line that refers to none
 * @param rhyme    the rhyme class of its final word — couplets are matched on this, never on
 *                 string suffixes, so a translator can re-author the corpus without the matcher
 *                 needing to understand their language's phonology
 * @param template the text, with {@code {}} where the kenning goes
 */
public record Line(Slot slot, String rhyme, String template) {

    public String render(String kenning) {
        return template.replace("{}", kenning);
    }
}
