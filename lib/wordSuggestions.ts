import { FSL_LABELS } from './labels';

/**
 * Curated dictionary of Filipino / Tagalog words and conversational replies
 * for fingerspelling assistance. English words are strictly excluded.
 */

// 1. Municipalities of Camarines Norte & nearby Bicol/PH regions
export const LOCAL_PLACES = [
    'DAET',
    'BASUD',
    'TALISAY',
    'MERCEDES',
    'LABO',
    'VINZONS',
    'PARACALE',
    'JOSE PANGANIBAN',
    'SAN VICENTE',
    'SAN LORENZO RUIZ',
    'CAPALONGA',
    'STA ELENA',
    'CAMARINES NORTE',
    'CAMARINES SUR',
    'NAGA',
    'LEGAZPI',
    'BICOL',
    'MANILA',
    'QUEZON'
];

// 2. Common Filipino names for answering "Ano ang pangalan mo?"
export const COMMON_NAMES = [
    'JAYZEL',
    'JUAN',
    'MARIA',
    'MARK',
    'JOHN',
    'ANA',
    'ANGEL',
    'ANGELO',
    'CARLOS',
    'DANIEL',
    'DAVE',
    'DAVID',
    'JOSE',
    'JOSHUA',
    'KATH',
    'LEO',
    'MIGUEL',
    'PAOLO',
    'SARAH'
];

// 3. Numbers & age answers in Tagalog for "Ilang taon ka na?"
export const AGE_AND_NUMBERS = [
    'ISA',
    'DALAWA',
    'TATLO',
    'APAT',
    'LIMA',
    'ANIM',
    'PITO',
    'WALO',
    'SIYAM',
    'SAMPU',
    'LABING-ISA',
    'LABING-DALAWA',
    'LABING-TATLO',
    'LABING-APAT',
    'LABING-LIMA',
    'LABING-ANIM',
    'LABING-PITO',
    'LABING-WALO',
    'LABING-SIYAM',
    'DALAWAMPU',
    'BENTE',
    'TREINTA',
    'TAON',
    'ANYOS'
];

// 4. Emotional states & conditions in Tagalog for "Kamusta ka?"
export const CONDITION_REPLIES = [
    'MABUTI',
    'MABUTI NAMAN',
    'MAAYOS',
    'MASAYA',
    'PAGOD',
    'OKAY LANG',
    'MALUNGKOT',
    'GUTOM',
    'UHAW',
    'MASIGLA',
    'MAY SAKIT'
];

// 5. Survival & dialogue responses in Tagalog
export const SURVIVAL_REPLIES = [
    'OO',
    'HINDI',
    'ALAM',
    'HINDI KO ALAM',
    'NAINTINDIHAN',
    'HINDI KO MAINTINDIHAN',
    'SALAMAT',
    'WALANG ANUMAN',
    'SANDALI',
    'PAALAM',
    'INGAT',
    'PAKIUSAP',
    'PAUMANHIN',
    'TULONG',
    'OSPITAL',
    'PULIS',
    'BAKIT',
    'PAANO',
    'DAHIL',
    'KASI'
];

// 6. Common everyday Filipino/Tagalog vocabulary
export const TAGALOG_VOCABULARY = [
    // Pronouns & Family
    'AKO', 'IKAW', 'SIYA', 'KAMI', 'TAYO', 'KAYO', 'SILA', 'AKIN', 'IYO', 'KANYA',
    'NAMIN', 'NATIN', 'NILA', 'TAO', 'BATA', 'LALAKI', 'BABAE', 'KAIBIGAN', 'MAGULANG',
    'KAPATID', 'KUYA', 'ATE', 'BUNSO', 'LOLO', 'LOLA', 'TIYO', 'TITA', 'PINSAN',
    'AMA', 'INA', 'ANAK',

    // Questions & Connectors
    'ANO', 'SINO', 'SAAN', 'KAILAN', 'BAKIT', 'PAANO', 'ILAN', 'MAGKANO', 'ALIN',
    'TARA', 'SIGE', 'OPO', 'HINDI PO', 'TALAGA', 'KAHIT',

    // Adjectives & States
    'MALAKI', 'MALIIT', 'MAGANDA', 'MABAIT', 'MASAMA', 'MASAYA', 'MALUNGKOT',
    'MAINIT', 'MALAMIG', 'MASARAP', 'MATAMIS', 'MAALAT', 'MAPAIT', 'MAASIM',
    'BAGO', 'LUMA', 'MABILIS', 'MABAGAL', 'MALAPIT', 'MALAYO', 'MADALI', 'MAHIRAP',
    'TAMA', 'MALI', 'GUSTO', 'AYAW', 'PWEDE', 'BAWAL', 'MAYROON', 'WALA', 'MERON',
    'DITO', 'DIYAN', 'DOON', 'NGAYON', 'BUKAS', 'KAHAPON', 'KANINA', 'MAMAYA',

    // Food, Drinks & Daily Life
    'PAGKAIN', 'TUBIG', 'KANIN', 'TINAPAY', 'ISDA', 'KARNE', 'MANOK', 'ITLOG', 'GATAS', 'KAPE', 'TSAA',
    'BAHAY', 'KWARTO', 'PINTO', 'BINTANA', 'KUSINA', 'LAMESA', 'UPUAN',
    'PERA', 'TRABAHO', 'ARAL', 'SULAT', 'BASA', 'ORAS', 'ARAW', 'GABI', 'UMAGA', 'HAPON'
];

// 7. College Courses & Degrees for school settings ("Ano ang course mo?")
export const COLLEGE_COURSES = [
    'BSIT',
    'BSHM',
    'BSCS',
    'BSIS',
    'BSTM',
    'BSBA',
    'BSA',
    'BSCRIM',
    'BSED',
    'BEED',
    'BSN',
    'BSCE',
    'BSEE',
    'BSME',
    'BSARCH',
    'BSPSYCH',
    'BSAGRI',
    'CRIMINOLOGY',
    'NURSING',
    'ENGINEERING',
    'EDUCATION',
    'ACCOUNTANCY',
    'HOSPITALITY',
    'TOURISM',
    'INFORMATION TECHNOLOGY',
    'COMPUTER SCIENCE',
    'BUSINESS ADMINISTRATION',
    'AGRICULTURE',
    'PSYCHOLOGY',
    'ARCHITECTURE',
    'POLSCI',
    'COMMUNICATION',
    'IT',
    'CS',
    'HRM',
    'TESDA',
    'VOCATIONAL'
];

// 8. School & Academic Vocabulary ("Saan ka nag-aaral?", school life, etc.)
export const SCHOOL_VOCABULARY = [
    'KURSO',
    'ESTUDYANTE',
    'GURO',
    'PROPESOR',
    'PAARALAN',
    'ESKWELAHAN',
    'ESKWELA',
    'KOLEHIYO',
    'UNIBERSIDAD',
    'KLASE',
    'LEKSYON',
    'ARALIN',
    'ARAL',
    'NAG-AARAL',
    'EKSAMEN',
    'PAGSUSULIT',
    'TAKDANG-ARALIN',
    'PROYEKTO',
    'SEMESTER',
    'PASADO',
    'BAGSAK',
    'GRADO',
    'SILID-ARALAN',
    'AKLATAN',
    'KANTINA',
    'UNIPORME',
    'ID',
    'BOLPEN',
    'PAPEL',
    'LIBRO',
    'NOTEBOOK',
    'BAG',
    'SUBJECT',
    'MATH',
    'SCIENCE',
    'ENGLISH',
    'FILIPINO',
    'HISTORY',
    'PE',
    'UNANG TAON',
    'IKALAWANG TAON',
    'IKATLONG TAON',
    'IKAAPAT NA TAON',
    'FIRST YEAR',
    'SECOND YEAR',
    'THIRD YEAR',
    'FOURTH YEAR',
    'GRADUATE',
    'MAGTATAPOS',
    'DEAN',
    'PRINCIPAL',
    'CAMPUS',
    'CNSC',
    'USANT',
    'AQUINAS'
];

// Words explicitly excluded from fingerspelling suggestions
export const EXCLUDED_WORDS = new Set([
    'BIRA',
    'AND',
    'THE',
    'IS',
    'TO',
    'FOR',
    'OF',
    'IN',
    'ON',
    'AT',
    'IT',
    'BE',
    'ARE',
    'WAS',
    'WERE',
    'NOT',
    'NO',
    'YES',
    'HELLO', // FSL_LABELS english
    'GOOD',
    'MORNING',
    'AFTERNOON',
    'EVENING',
    'NIGHT',
    'UNDERSTAND',
    'KNOW',
    'WELCOME',
    'HOW',
    'WHAT',
    'WHERE',
    'NAME',
    'FINE',
    'SEE',
    'YOU',
    'MEET',
    'NICE',
    'THANK',
    'PLEASE',
    'SORRY',
    'ONE',
    'TWO',
    'THREE',
    'FOUR',
    'FIVE',
    'SIX',
    'SEVEN',
    'EIGHT',
    'NINE',
    'TEN',
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER',
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
    'TODAY',
    'TOMORROW',
    'YESTERDAY',
    'FATHER',
    'MOTHER',
    'SON',
    'DAUGHTER',
    'GRANDFATHER',
    'GRANDMOTHER',
    'UNCLE',
    'AUNTIE',
    'COUSIN',
    'PARENTS',
    'BOY',
    'GIRL',
    'MAN',
    'WOMAN',
    'DEAF',
    'BLIND',
    'MARRIED',
    'BLUE',
    'GREEN',
    'RED',
    'BROWN',
    'BLACK',
    'WHITE',
    'YELLOW',
    'ORANGE',
    'GRAY',
    'PINK',
    'VIOLET',
    'LIGHT',
    'DARK',
    'BREAD',
    'EGG',
    'FISH',
    'MEAT',
    'CHICKEN',
    'SPAGHETTI',
    'RICE',
    'SHRIMP',
    'CRAB',
    'HOT',
    'COLD',
    'JUICE',
    'MILK',
    'COFFEE',
    'TEA',
    'BEER',
    'WINE',
    'SUGAR',
    'SLOW',
    'FAST',
    'WRONG',
    'CORRECT'
]);

// Compile a unified Master Word Set — Tagalog / Filipino words, courses & school vocabulary
const MASTER_WORDS: string[] = Array.from(
    new Set([
        ...COLLEGE_COURSES,
        ...SCHOOL_VOCABULARY,
        ...LOCAL_PLACES,
        ...COMMON_NAMES,
        ...AGE_AND_NUMBERS,
        ...CONDITION_REPLIES,
        ...SURVIVAL_REPLIES,
        ...TAGALOG_VOCABULARY,
        // ONLY Filipino words from FSL_LABELS (English labels are excluded)
        ...FSL_LABELS.flatMap(l => l.filipino.split(/\s+/))
    ])
)
    .map(w => w.replace(/[^A-Z0-9-]/g, '').trim())
    .filter(w => w.length >= 1 && !EXCLUDED_WORDS.has(w));

/**
 * Returns prioritized suggestions matching the active fingerspelled prefix.
 * Only Tagalog / Filipino words and school courses/terms are returned.
 *
 * @param prefix Current typed letters (e.g. "BS" or "DA")
 * @param avatarPrompt Recent speech/sign from 3D avatar (e.g. "ANO ANG COURSE MO")
 * @param limit Maximum suggestions to return (default 6)
 */
export function getWordSuggestions(
    prefix: string,
    avatarPrompt?: string,
    limit: number = 6
): string[] {
    const cleanPrefix = (prefix || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').trim();
    const normPrompt = (avatarPrompt || '').toUpperCase();

    // Determine context categories based on the avatar's question / speech
    const isCourseContext = normPrompt.includes('COURSE') || 
                            normPrompt.includes('KURSO') || 
                            normPrompt.includes('MAJOR') || 
                            normPrompt.includes('PROGRAM');

    const isSchoolContext = isCourseContext || 
                            normPrompt.includes('PAARALAN') || 
                            normPrompt.includes('ESKWELA') || 
                            normPrompt.includes('ESKWELAHAN') || 
                            normPrompt.includes('KOLEHIYO') || 
                            normPrompt.includes('UNIBERSIDAD') || 
                            normPrompt.includes('ARAL') || 
                            normPrompt.includes('SCHOOL') || 
                            normPrompt.includes('STUDY') || 
                            normPrompt.includes('STUDENT') || 
                            normPrompt.includes('ESTUDYANTE') || 
                            normPrompt.includes('KLASE');

    const isLocationContext = normPrompt.includes('SAAN') || normPrompt.includes('TIRA') || normPrompt.includes('WHERE');
    const isNameContext = normPrompt.includes('PANGALAN') || normPrompt.includes('NAME');
    const isAgeContext = normPrompt.includes('TAON') || normPrompt.includes('EDAD') || normPrompt.includes('AGE') || normPrompt.includes('OLD') || normPrompt.includes('ILANG');
    const isConditionContext = normPrompt.includes('KAMUSTA') || normPrompt.includes('KUMUSTA') || normPrompt.includes('HOW ARE YOU');

    // If prefix is empty but we have an active context from the avatar prompt,
    // return instant 1-tap contextual recommendations:
    if (!cleanPrefix) {
        if (isCourseContext) {
            return ['BSIT', 'BSHM', 'BSBA', 'BSCS', 'BSED', 'BSCRIM', 'BSN', 'IT'].slice(0, limit);
        }
        if (isSchoolContext) {
            return ['BSIT', 'BSHM', 'ESTUDYANTE', 'KOLEHIYO', 'KLASE', 'PAARALAN'].slice(0, limit);
        }
        if (isNameContext) {
            return ['JAYZEL', 'MARK', 'JOHN', 'MARIA', 'ANA', 'ANGEL'].slice(0, limit);
        }
        if (isLocationContext) {
            return ['DAET', 'BASUD', 'TALISAY', 'MERCEDES', 'LABO', 'VINZONS'].slice(0, limit);
        }
        if (isAgeContext) {
            return ['BENTE', 'LABING-SIYAM', 'DALAWAMPU', 'LABING-WALO', 'TREINTA'].slice(0, limit);
        }
        if (isConditionContext) {
            return ['MABUTI', 'MAAYOS', 'MASAYA', 'OKAY LANG', 'PAGOD'].slice(0, limit);
        }
        return [];
    }

    // Filter matching words
    const matches = MASTER_WORDS.filter(w => w.startsWith(cleanPrefix));

    // Sort by relevance:
    // 1. Matches from the contextually boosted group
    // 2. Exact prefix matches with shortest length
    // 3. Alphabetical order
    matches.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        if (isCourseContext) {
            if (COLLEGE_COURSES.includes(a)) scoreA += 250;
            if (COLLEGE_COURSES.includes(b)) scoreB += 250;
            if (SCHOOL_VOCABULARY.includes(a)) scoreA += 100;
            if (SCHOOL_VOCABULARY.includes(b)) scoreB += 100;
        } else if (isSchoolContext) {
            if (SCHOOL_VOCABULARY.includes(a)) scoreA += 200;
            if (SCHOOL_VOCABULARY.includes(b)) scoreB += 200;
            if (COLLEGE_COURSES.includes(a)) scoreA += 150;
            if (COLLEGE_COURSES.includes(b)) scoreB += 150;
        } else if (isLocationContext) {
            if (LOCAL_PLACES.includes(a)) scoreA += 150;
            if (LOCAL_PLACES.includes(b)) scoreB += 150;
        } else if (isNameContext) {
            if (COMMON_NAMES.includes(a)) scoreA += 150;
            if (COMMON_NAMES.includes(b)) scoreB += 150;
        } else if (isAgeContext) {
            if (AGE_AND_NUMBERS.includes(a)) scoreA += 150;
            if (AGE_AND_NUMBERS.includes(b)) scoreB += 150;
        } else if (isConditionContext) {
            if (CONDITION_REPLIES.includes(a)) scoreA += 150;
            if (CONDITION_REPLIES.includes(b)) scoreB += 150;
        }

        // Favor popular courses when starting with 'B', 'I', 'C', 'H', etc.
        if (COLLEGE_COURSES.includes(a)) scoreA += 30;
        if (COLLEGE_COURSES.includes(b)) scoreB += 30;

        // Prefer shorter words (e.g. BSIT before a longer word)
        scoreA -= a.length;
        scoreB -= b.length;

        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }
        return a.localeCompare(b);
    });

    return matches.slice(0, limit);
}
