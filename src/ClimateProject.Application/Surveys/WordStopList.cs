using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// Function words left out of the open-text word frequencies, per content language.
/// </summary>
/// <remarks>
/// The TIMS dry run's cloud led with "el" 8, "la" 7, "y" 5, "de" 4 -- the grammar of the
/// answers, not what they were about. These words carry no theme in any answer, so they are
/// dropped before counting rather than counted and withheld: they are not a privacy
/// decision, and folding them into <c>SuppressedWordCount</c> would tell the reader that
/// words were protected when none were. The lists are deliberately short -- articles,
/// prepositions, pronouns, conjunctions and the commonest auxiliaries -- so a word a
/// respondent chose ("equipo", "confianza", "salario") is never among them.
/// </remarks>
public static class WordStopList
{
    private static readonly HashSet<string> Spanish = new(StringComparer.Ordinal)
    {
        "a", "al", "algo", "algún", "alguna", "algunas", "alguno", "algunos", "ante", "antes", "aquí",
        "así", "aun", "aún", "bien", "cada", "como", "cómo", "con", "contra", "cual", "cuál", "cuando",
        "de", "del", "desde", "donde", "dónde", "durante", "e", "el", "él", "ella", "ellas", "ello",
        "ellos", "en", "entre", "era", "es", "esa", "esas", "ese", "eso", "esos", "esta", "está",
        "están", "estas", "este", "esto", "estos", "fue", "ha", "han", "hay", "hacia", "hasta", "la",
        "las", "le", "les", "lo", "los", "más", "me", "mi", "mis", "mucho", "muy", "nada", "ni", "no",
        "nos", "nosotros", "nuestra", "nuestras", "nuestro", "nuestros", "o", "otra", "otras", "otro",
        "otros", "para", "pero", "poco", "por", "porque", "que", "qué", "quien", "quién", "se", "sea",
        "ser", "si", "sí", "sin", "sobre", "son", "su", "sus", "también", "tan", "te", "tener", "tiene",
        "todo", "todos", "tu", "tus", "u", "un", "una", "unas", "uno", "unos", "y", "ya", "yo",
    };

    private static readonly HashSet<string> English = new(StringComparer.Ordinal)
    {
        "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
        "been", "being", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has",
        "have", "he", "her", "his", "i", "if", "in", "into", "is", "it", "its", "just", "me", "more",
        "my", "no", "not", "of", "on", "or", "our", "out", "she", "so", "some", "than", "that", "the",
        "their", "them", "then", "there", "these", "they", "this", "those", "to", "too", "up", "us",
        "very", "was", "we", "were", "what", "when", "which", "who", "will", "with", "would", "you",
        "your",
    };

    /// <summary>True when <paramref name="word"/> (already lower-cased) is a function word in <paramref name="language"/>.</summary>
    public static bool Contains(string language, string word)
        => (language == ContentLanguages.Spanish ? Spanish : language == ContentLanguages.English ? English : null)?.Contains(word) ?? false;
}
