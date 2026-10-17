# Leciona — guia para o Claude

App de gestão da rotina docente do prof. Cadu (Carlos Eduardo Michel), professor de História em
quatro escolas de Brusque/SC. Ele é o único usuário e usa o app todos os dias, no computador e no
celular. **Cadu é professor, não programador**: explique em português simples, sem jargão, e seja
objetivo.

## Como trabalhamos
- Código no GitHub `cadumichel/leciona`. Produção em **leciona.vercel.app**, que a Vercel publica
  sozinha a cada merge na `main`.
- Toda mudança vai num branch + pull request. **Quem faz o merge é o Cadu.**
- Ele também edita pelo Antigravity. Antes de começar qualquer trabalho, rode `git pull`. Use uma
  ferramenta de cada vez.
- Commits, PRs e textos de interface em português.
- Mudou algo visual? Mostre como ficou (capturas de tela) antes de pedir o merge.
- **Nunca** coloque no repositório backups ou dados reais: os nomes de alunos são de menores de idade.

## Regras que o Cadu pediu
- **Celular e computador são layouts separados no Início.** Só mude um deles quando ele pedir.
- **"Atividade Agora" é o item mais importante do Início**: não mude o design nem o comportamento
  sem pedido explícito (é o mesmo bloco `activityCard` nos dois layouts).
- Aulas seguidas na mesma turma aparecem sempre separadas (nunca juntar em uma só).
- Número da aula = posição dentro do turno (1ª, 2ª…), contando só os horários de aula e recomeçando
  em cada turno (vespertino começa na 1ª).

## Comandos
- `npm test`: testes (vitest, fuso America/Sao_Paulo; ficam em `tests/`).
- `npx tsc --noEmit -p .`: tipos. Já existem ~28 erros antigos; **não adicione novos**.
- `npx vite build`: build de produção.
- `npm run dev`: app local.

## Arquitetura (o que importa saber)
- React 19 + TypeScript + Vite 6 + PWA (vite-plugin-pwa), ícones lucide-react.
- **Tailwind vem por CDN** (`index.html`), não é compilado. As cores do tema são CSS próprio em
  `App.tsx`: só existem `text-primary`, `bg-primary`, `border-primary`, `ring-primary` e
  `bg-primary-light`. Variações como `bg-primary/5` **não funcionam**; use
  `style={{ backgroundColor: 'var(--primary-color)' }}` (ou `--primary-light`, `--primary-medium`).
- **Dados**: login Google (Firebase Auth) + **um único documento no Firestore, `users/{uid}`**
  (limite de 1 MiB), espelhado no `localStorage` (`leciona-data-v1`).
- **Sincronização**: `hooks/useSyncedData.ts` + `utils/sync.ts`. Cada item tem carimbo de edição
  `_m`; exclusões viram lápides em `_deleted` (180 dias); perfil e ajustes usam `_fieldM`. A nuvem
  vence, a não ser que haja alterações locais pendentes; nesse caso as duas versões são juntadas item
  a item. Qualquer coisa que grave nesse documento precisa respeitar essas regras.
- **Turmas**: a grade (`scheduleVersions[].schedules`) guarda o **nome** da turma; diário (`logs`),
  avaliações/eventos (`events`) e listas (`classRecords`) guardam o **código (id)**. Use sempre
  `utils/classRefs.ts` (`getClassName`, `isSameClassRef`, `resolveClass`). Nunca mostre o código ao
  usuário.
- **Datas**: `YYYY-MM-DDT00:00:00.000Z` representa um dia do calendário (não um instante). Use
  `getSafeDate` e `formatDateBR` (`utils.ts`).
- **Grade em vigor numa data**: `getSchedulesForDate` (`utils/schedule.ts`).
- **Aulas, pendências e bloqueios** (feriado, recesso, evento que suspende aula):
  `utils/lessonStats.ts` (`getLessonDisplayItems`, `isLessonBlocked`).
- **Avaliações**: `events` com `type` `test`/`work`; `slotId` = a aula em que acontece;
  `prepared` = já elaborada. Ao cadastrar, o app cria no diário o registro "Avaliação: {título}"
  naquela aula (`components/AssessmentManagement.tsx`, `handleSaveEvent`).
- **Início**: `components/Dashboard.tsx` + `utils/dashboardWeb.ts` (linha do dia e grade semanal).
- **Virada do ano letivo**: `utils/newSchoolYear.ts` + `components/NewSchoolYearWizard.tsx`.
- **Planilhas exportadas**: `utils/exportRows.ts`.

## Próximo projeto: conector do Leciona para o Claude
Objetivo: o Claude ler e (depois) escrever no Leciona, como um conector (servidor MCP remoto
hospedado no próprio projeto da Vercel, lendo o Firestore com o Firebase Admin).

**Etapa 1, só leitura**
- Avaliações por período, escola ou turma, indicando se já foram elaboradas.
- Conteúdo dado em cada turma desde a última avaliação (diário).
- Turmas, grade e calendário.
- Alertas: tarefa agendada no Claude que avisa quando há prova se aproximando, com o conteúdo.

**Etapa 2, escrita** (só depois da etapa 1 funcionar bem)
- Cadastrar avaliações a partir de uma lista (texto, foto ou PDF do calendário da escola).
  **Sempre mostrar uma prévia e só gravar com a confirmação do Cadu.** Validar como o app faz: a
  turma tem aula na data? é feriado ou recesso? já existe? Quando houver aulas seguidas, perguntar
  em qual. Criar o registro "Avaliação: X" no diário, como o app faz. Permitir desfazer o lote.
- Marcar avaliação como elaborada.
- Registrar o conteúdo de aulas no diário ("hoje no 183 dei…").

**Restrições**
- Nunca expor nomes de alunos, notas ou chamada pelo conector.
- Autenticação forte: só o Cadu acessa.
- A credencial do Firebase Admin fica nas variáveis de ambiente da Vercel. Nunca no código e nunca
  colada no chat.
- O conector grava como "mais um aparelho": carimbos `_m`, lápides, gravação em transação. Testar
  com o app aberto ao mesmo tempo no computador e no celular.

## Pendente depois do conector: notas (`components/GradesManagement.tsx`)
- `maxGrade` é ignorado no cálculo; falta a opção de soma.
- A fórmula personalizada (N1…Nn) se desloca quando colunas são adicionadas.
- Os ids das notas são regenerados.
