export interface FSLLabel {
    id: number;
    english: string;
    filipino: string;
    category: string;
}

export const FSL_LABELS: FSLLabel[] = [
    { id: 0,   english: "GOOD MORNING",      filipino: "MAGANDANG UMAGA",      category: "GREETING" },
    { id: 1,   english: "GOOD AFTERNOON",     filipino: "MAGANDANG HAPON",      category: "GREETING" },
    { id: 2,   english: "GOOD EVENING",       filipino: "MAGANDANG GABI",       category: "GREETING" },
    { id: 3,   english: "HELLO",              filipino: "HALO",                 category: "GREETING" },
    { id: 4,   english: "HOW ARE YOU",        filipino: "KUMUSTA KA",           category: "GREETING" },
    { id: 5,   english: "IM FINE",            filipino: "MABUTI",               category: "GREETING" },
    { id: 6,   english: "NICE TO MEET YOU",   filipino: "KINAGAGALAK KITA",     category: "GREETING" },
    { id: 7,   english: "THANK YOU",          filipino: "SALAMAT",              category: "GREETING" },
    { id: 8,   english: "YOURE WELCOME",      filipino: "WALANG ANUMAN",        category: "GREETING" },
    { id: 9,   english: "SEE YOU TOMORROW",   filipino: "KITA TAYO BUKAS",      category: "GREETING" },
    { id: 10,  english: "UNDERSTAND",         filipino: "NAINTINDIHAN",         category: "SURVIVAL" },
    { id: 11,  english: "DON'T UNDERSTAND",   filipino: "HINDI NAINTINDIHAN",   category: "SURVIVAL" },
    { id: 12,  english: "KNOW",               filipino: "ALAM",                 category: "SURVIVAL" },
    { id: 13,  english: "DON'T KNOW",         filipino: "HINDI ALAM",           category: "SURVIVAL" },
    { id: 14,  english: "NO",                 filipino: "HINDI",                category: "SURVIVAL" },
    { id: 15,  english: "YES",                filipino: "OO",                   category: "SURVIVAL" },
    { id: 16,  english: "WRONG",              filipino: "MALI",                 category: "SURVIVAL" },
    { id: 17,  english: "CORRECT",            filipino: "TAMA",                 category: "SURVIVAL" },
    { id: 18,  english: "SLOW",               filipino: "MABAGAL",              category: "SURVIVAL" },
    { id: 19,  english: "FAST",               filipino: "MABILIS",              category: "SURVIVAL" },
    { id: 20,  english: "ONE",                filipino: "ISA",                  category: "NUMBER" },
    { id: 21,  english: "TWO",                filipino: "DALAWA",               category: "NUMBER" },
    { id: 22,  english: "THREE",              filipino: "TATLO",                category: "NUMBER" },
    { id: 23,  english: "FOUR",               filipino: "APAT",                 category: "NUMBER" },
    { id: 24,  english: "FIVE",               filipino: "LIMA",                 category: "NUMBER" },
    { id: 25,  english: "SIX",                filipino: "ANIM",                 category: "NUMBER" },
    { id: 26,  english: "SEVEN",              filipino: "PITO",                 category: "NUMBER" },
    { id: 27,  english: "EIGHT",              filipino: "WALO",                 category: "NUMBER" },
    { id: 28,  english: "NINE",               filipino: "SIYAM",                category: "NUMBER" },
    { id: 29,  english: "TEN",                filipino: "SAMPU",                category: "NUMBER" },
    { id: 30,  english: "JANUARY",            filipino: "ENERO",                category: "CALENDAR" },
    { id: 31,  english: "FEBRUARY",           filipino: "PEBRERO",              category: "CALENDAR" },
    { id: 32,  english: "MARCH",              filipino: "MARSO",                category: "CALENDAR" },
    { id: 33,  english: "APRIL",              filipino: "ABRIL",                category: "CALENDAR" },
    { id: 34,  english: "MAY",                filipino: "MAYO",                 category: "CALENDAR" },
    { id: 35,  english: "JUNE",               filipino: "HUNYO",                category: "CALENDAR" },
    { id: 36,  english: "JULY",               filipino: "HULYO",                category: "CALENDAR" },
    { id: 37,  english: "AUGUST",             filipino: "AGOSTO",               category: "CALENDAR" },
    { id: 38,  english: "SEPTEMBER",          filipino: "SETYEMBRE",            category: "CALENDAR" },
    { id: 39,  english: "OCTOBER",            filipino: "OKTUBRE",              category: "CALENDAR" },
    { id: 40,  english: "NOVEMBER",           filipino: "NOBYEMBRE",            category: "CALENDAR" },
    { id: 41,  english: "DECEMBER",           filipino: "DISYEMBRE",            category: "CALENDAR" },
    { id: 42,  english: "MONDAY",             filipino: "LUNES",                category: "DAYS" },
    { id: 43,  english: "TUESDAY",            filipino: "MARTES",               category: "DAYS" },
    { id: 44,  english: "WEDNESDAY",          filipino: "MIYERKULES",           category: "DAYS" },
    { id: 45,  english: "THURSDAY",           filipino: "HUWEBES",              category: "DAYS" },
    { id: 46,  english: "FRIDAY",             filipino: "BIYERNES",             category: "DAYS" },
    { id: 47,  english: "SATURDAY",           filipino: "SABADO",               category: "DAYS" },
    { id: 48,  english: "SUNDAY",             filipino: "LINGGO",               category: "DAYS" },
    { id: 49,  english: "TODAY",              filipino: "NGAYON",               category: "DAYS" },
    { id: 50,  english: "TOMORROW",           filipino: "BUKAS",                category: "DAYS" },
    { id: 51,  english: "YESTERDAY",          filipino: "KAHAPON",              category: "DAYS" },
    { id: 52,  english: "FATHER",             filipino: "AMA",                  category: "FAMILY" },
    { id: 53,  english: "MOTHER",             filipino: "INA",                  category: "FAMILY" },
    { id: 54,  english: "SON",                filipino: "ANAK NA LALAKI",       category: "FAMILY" },
    { id: 55,  english: "DAUGHTER",           filipino: "ANAK NA BABAE",        category: "FAMILY" },
    { id: 56,  english: "GRANDFATHER",        filipino: "LOLO",                 category: "FAMILY" },
    { id: 57,  english: "GRANDMOTHER",        filipino: "LOLA",                 category: "FAMILY" },
    { id: 58,  english: "UNCLE",              filipino: "TIYO",                 category: "FAMILY" },
    { id: 59,  english: "AUNTIE",             filipino: "TIYA",                 category: "FAMILY" },
    { id: 60,  english: "COUSIN",             filipino: "PINSAN",               category: "FAMILY" },
    { id: 61,  english: "PARENTS",            filipino: "MAGULANG",             category: "FAMILY" },
    { id: 62,  english: "BOY",                filipino: "LALAKI",               category: "RELATIONSHIPS" },
    { id: 63,  english: "GIRL",               filipino: "BATA",                 category: "RELATIONSHIPS" },
    { id: 64,  english: "MAN",                filipino: "LALAKI",               category: "RELATIONSHIPS" },
    { id: 65,  english: "WOMAN",              filipino: "BABAE",                category: "RELATIONSHIPS" },
    { id: 66,  english: "DEAF",               filipino: "BINGI",                category: "RELATIONSHIPS" },
    { id: 67,  english: "HARD OF HEARING",    filipino: "MAHINA PANDINIG",      category: "RELATIONSHIPS" },
    { id: 68,  english: "WHEELCHAIR PERSON",  filipino: "NAKA-WHEELCHAIR",      category: "RELATIONSHIPS" },
    { id: 69,  english: "BLIND",              filipino: "BULAG",                category: "RELATIONSHIPS" },
    { id: 70,  english: "DEAF BLIND",         filipino: "BINGI-BULAG",          category: "RELATIONSHIPS" },
    { id: 71,  english: "MARRIED",            filipino: "KASAL",                category: "RELATIONSHIPS" },
    { id: 72,  english: "BLUE",               filipino: "ASUL",                 category: "COLOR" },
    { id: 73,  english: "GREEN",              filipino: "BERDE",                category: "COLOR" },
    { id: 74,  english: "RED",                filipino: "PULA",                 category: "COLOR" },
    { id: 75,  english: "BROWN",              filipino: "KAYUMANGGI",           category: "COLOR" },
    { id: 76,  english: "BLACK",              filipino: "ITIM",                 category: "COLOR" },
    { id: 77,  english: "WHITE",              filipino: "PUTI",                 category: "COLOR" },
    { id: 78,  english: "YELLOW",             filipino: "DILAW",                category: "COLOR" },
    { id: 79,  english: "ORANGE",             filipino: "KAHEL",                category: "COLOR" },
    { id: 80,  english: "GRAY",               filipino: "ABO",                  category: "COLOR" },
    { id: 81,  english: "PINK",               filipino: "ROSAS",                category: "COLOR" },
    { id: 82,  english: "VIOLET",             filipino: "LILA",                 category: "COLOR" },
    { id: 83,  english: "LIGHT",              filipino: "MALIWANAG",            category: "COLOR" },
    { id: 84,  english: "DARK",               filipino: "MADILIM",              category: "COLOR" },
    { id: 85,  english: "BREAD",              filipino: "TINAPAY",              category: "FOOD" },
    { id: 86,  english: "EGG",                filipino: "ITLOG",                category: "FOOD" },
    { id: 87,  english: "FISH",               filipino: "ISDA",                 category: "FOOD" },
    { id: 88,  english: "MEAT",               filipino: "KARNE",                category: "FOOD" },
    { id: 89,  english: "CHICKEN",            filipino: "MANOK",                category: "FOOD" },
    { id: 90,  english: "SPAGHETTI",          filipino: "ISPAGETI",             category: "FOOD" },
    { id: 91,  english: "RICE",               filipino: "KANIN",                category: "FOOD" },
    { id: 92,  english: "LONGANISA",          filipino: "LONGGANISA",           category: "FOOD" },
    { id: 93,  english: "SHRIMP",             filipino: "HIPON",                category: "FOOD" },
    { id: 94,  english: "CRAB",               filipino: "ALIMANGO",             category: "FOOD" },
    { id: 95,  english: "HOT",                filipino: "MAINIT",               category: "DRINK" },
    { id: 96,  english: "COLD",               filipino: "MALAMIG",              category: "DRINK" },
    { id: 97,  english: "JUICE",              filipino: "INUMIN",               category: "DRINK" },
    { id: 98,  english: "MILK",               filipino: "GATAS",                category: "DRINK" },
    { id: 99,  english: "COFFEE",             filipino: "KAPE",                 category: "DRINK" },
    { id: 100, english: "TEA",                filipino: "TSAA",                 category: "DRINK" },
    { id: 101, english: "BEER",               filipino: "BIRA",                 category: "DRINK" },
    { id: 102, english: "WINE",               filipino: "ALAK",                 category: "DRINK" },
    { id: 103, english: "SUGAR",              filipino: "ASUKAL",               category: "DRINK" },
    { id: 104, english: "NO SUGAR",           filipino: "WALANG ASUKAL",        category: "DRINK" },
];

export function getLabelById(id: number): FSLLabel {
    return FSL_LABELS[id] ?? { id, english: "UNKNOWN", filipino: "HINDI KILALA", category: "UNKNOWN" };
}

export function matchSpeechToLabel(speech: string): FSLLabel | null {
    const normalized = speech.toUpperCase().trim();
    return (
        FSL_LABELS.find(l => l.english === normalized) ??
        FSL_LABELS.find(l => l.filipino === normalized) ??
        FSL_LABELS.find(l => normalized.includes(l.english)) ??
        FSL_LABELS.find(l => normalized.includes(l.filipino)) ??
        null
    );
}

export const ALPHABET_LABELS: string[] = [
    'A','B','C','D','E','F','G','H','I','J','K','L','M',
    'N','O','P','Q','R','S','T','U','V','W','X','Y','Z'
];
