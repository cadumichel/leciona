export interface ProcessedStudent {
    originalName: string;
    displayName: string;
}

export type FormatMode = 'intelligent' | 'formal' | 'abbreviated' | 'full';

/**
 * Limpeza agressiva de nomes
 */
function cleanName(text: string): string {
    // 1. Remove TODOS os números e Símbolos Problemáticos (#, @, %, $, _)
    // A remoção deve ser feita ANTES de qualquer split para evitar problemas com sobrenomes
    // Adicionado explicitamente: # @ % $ _ e mantidos os anteriores
    let cleaned = text.replace(/[\d#@%$_\-*\.•\)\]\(]/g, '');

    // 2. Remove letras duplicadas no início (ex: "AAna" -> "Ana")
    cleaned = cleaned.replace(/^([a-zA-ZÀ-ÿ])\1+/, '$1');

    // 3. Trim final para garantir que não sobram espaços (ex: "Carlos # " -> "Carlos")
    cleaned = cleaned.trim();

    // 4. Substitui múltiplos espaços por um único
    cleaned = cleaned.replace(/\s+/g, ' ');

    return cleaned;
}

/**
 * Processa uma lista bruta de nomes de alunos com modo de formatação
 */
export function processStudentList(
    rawText: string,
    formatMode: FormatMode = 'intelligent'
): ProcessedStudent[] {
    // 1. Dividir em linhas e limpar
    const lines = rawText
        .split('\n')
        .map(line => cleanName(line))
        .filter(line => line.length > 0);

    // 2. Parsear nomes (primeiro + último sobrenome)
    const parsedNames = lines.map(fullName => {
        const parts = fullName.split(' ').filter(p => p.length > 0);
        const firstName = parts[0];
        const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
        return { fullName, firstName, lastName };
    });

    // 3. Detectar homônimos (para modo inteligente e abreviado)
    const firstNameCounts = new Map<string, number>();
    parsedNames.forEach(({ firstName }) => {
        const normalized = firstName.toLowerCase();
        firstNameCounts.set(normalized, (firstNameCounts.get(normalized) || 0) + 1);
    });

    // 4. Aplicar formatação baseada no modo
    const processed: ProcessedStudent[] = parsedNames.map(({ fullName, firstName, lastName }) => {
        const normalized = firstName.toLowerCase();
        const count = firstNameCounts.get(normalized) || 0;
        const isHomonym = count > 1;

        let displayName: string;

        switch (formatMode) {
            case 'formal':
                // Sempre primeiro + último
                displayName = lastName ? `${firstName} ${lastName}` : firstName;
                break;

            case 'abbreviated':
                // Se homônimo: primeiro + último
                // Se único: primeiro + inicial do sobrenome
                if (isHomonym) {
                    displayName = lastName ? `${firstName} ${lastName}` : firstName;
                } else {
                    displayName = lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
                }
                break;

            case 'full':
                // Nome completo exatamente como foi fornecido
                displayName = fullName;
                break;

            case 'intelligent':
            default:
                // Se homônimo: primeiro + último
                // Se único: apenas primeiro
                displayName = isHomonym && lastName
                    ? `${firstName} ${lastName}`
                    : firstName;
                break;
        }

        return {
            originalName: fullName,
            displayName
        };
    });

    return processed;
}
