export interface ParsedHoliday {
    date: string; // YYYY-MM-DD
    name: string;
}

const MONTH_MAP: { [key: string]: string } = {
    'janeiro': '01', 'jan': '01',
    'fevereiro': '02', 'fev': '02',
    'março': '03', 'marco': '03', 'mar': '03',
    'abril': '04', 'abr': '04',
    'maio': '05', 'mai': '05',
    'junho': '06', 'jun': '06',
    'julho': '07', 'jul': '07',
    'agosto': '08', 'ago': '08',
    'setembro': '09', 'set': '09',
    'outubro': '10', 'out': '10',
    'novembro': '11', 'nov': '11',
    'dezembro': '12', 'dez': '12'
};

export function parseHolidayList(text: string, defaultYear: number): ParsedHoliday[] {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const results: ParsedHoliday[] = [];

    for (const line of lines) {
        const cleanLine = line.trim();
        let datePart = '';
        let namePart = '';

        // Tenta padrão dd/mm/aaaa ou dd/mm
        const numericMatch = cleanLine.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);

        if (numericMatch) {
            const day = numericMatch[1].padStart(2, '0');
            const month = numericMatch[2].padStart(2, '0');
            const year = numericMatch[3] || defaultYear.toString();
            datePart = `${year}-${month}-${day}`;

            // O resto da string é o nome (remove a data e delimitadores comuns)
            namePart = cleanLine.replace(numericMatch[0], '')
                .replace(/^[\s\-\.\:]+/, '') // Remove separadores iniciais (- . :)
                .trim();
        } else {
            // Tenta padrão "dd de Mes"
            const extMatch = cleanLine.match(/^(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)/i);

            if (extMatch) {
                const day = extMatch[1].padStart(2, '0');
                const monthName = extMatch[2].toLowerCase();
                const month = MONTH_MAP[monthName];

                if (month) {
                    datePart = `${defaultYear}-${month}-${day}`;
                    namePart = cleanLine.replace(extMatch[0], '')
                        .replace(/^[\s\-\.\:]+/, '')
                        .trim();
                }
            }
        }

        if (datePart && namePart) {
            results.push({ date: datePart, name: namePart });
        }
    }

    return results;
}
