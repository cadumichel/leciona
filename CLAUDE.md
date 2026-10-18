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
- `npx tsc --noEmit -p .`: tipos. Já existem ~22 erros antigos; **não adicione novos**.
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
  Para a data de **hoje**, use `todayLocal()` (`utils.ts`); nunca `new Date().toISOString()`, que
  depois das 21h no Brasil já dá o dia seguinte.
- **Grade em vigor numa data**: `getSchedulesForDate` (`utils/schedule.ts`).
- **Mudança de grade** (nova versão, edição ou exclusão de versão): `utils/scheduleChange.ts`
  (`planScheduleChange`, `applyScheduleDecisions`) + janela "Ajustar Planejamento Futuro"
  (`components/MigrationWizard.tsx`). Nada antes da data da versão nem depois da versão seguinte
  muda; a correspondência é pela ordem das aulas da turma na semana (horários reais), nunca dois
  itens no mesmo horário; avaliações vão junto com o registro "Avaliação:".
- **Aulas, pendências e bloqueios** (feriado, recesso, evento que suspende aula):
  `utils/lessonStats.ts` (`getLessonDisplayItems`, `isLessonBlocked`).
- **Avaliações**: `events` com `type` `test`/`work`; `slotId` = a aula em que acontece. Ao
  cadastrar, o app cria no diário o registro "Avaliação: {título}" naquela aula
  (`components/AssessmentManagement.tsx`, `handleSaveEvent`).
- **Situação da avaliação** (uma caixa só no app): **Pendente** = vai acontecer, alunos ainda não
  avisados; **Agendada** (`scheduled`) = comunicada aos alunos; **Pronta** (`prepared`) = enviada
  para a coordenação e impressão. Escolher "Pronta" desliga `scheduled`, mas os alunos já sabem.
- **Recuperação e 2ª chamada** (`utils/recovery.ts`): regra por escola em Ajustes → Escolas
  (`School.recoveryPolicy`: nenhuma/paralela/trimestral, `recoveryDelayDays`, `secondCallMode`).
  Avaliação derivada tem `kind` (`recovery`, `term_recovery`, `second_call`) e `parentId` (a
  original). Cônsul: REC paralela 15 dias depois, criada junto com a prova; Uniavan e São Luiz: REC
  trimestral com o conteúdo das provas do trimestre; 2ª chamada copia a original (no São Luiz, no
  contraturno: sem aula e sem registro no diário). Apagar a original apaga as ligadas.
- **Início**: `components/Dashboard.tsx` + `utils/dashboardWeb.ts` (linha do dia e grade semanal).
- **Virada do ano letivo**: `utils/newSchoolYear.ts` + `components/NewSchoolYearWizard.tsx`.
- **Planilhas exportadas**: `utils/exportRows.ts`.
- **Retrospectiva do Diário** (janela de registro da aula): `utils/retrospective.ts`. Mostra a aula
  imediatamente anterior da turma pela grade (sem feriados, recessos e aulas removidas; aulas extras
  contam), mesmo sem conteúdo ("Sem conteúdo cadastrado"). Nunca pular para o último registro.
- **Aulas que faltam no período**: `utils/remainingLessons.ts`. Linha abaixo da retrospectiva no
  Diário ("Faltam N aulas da turma até o fim do trimestre · próxima avaliação…") e ferramenta
  `aulas_restantes` do conector. Mesma regra de aulas do Diário (sem feriados/recessos).
- **Notas** (`components/GradesManagement.tsx` + `utils/grades.ts`):
  - Média aritmética e ponderada contam cada nota proporcionalmente à nota máxima (3 de 3 = 10);
    a opção "Soma" soma as notas como lançadas; avaliação sem nota fica fora do cálculo.
  - Fórmula personalizada: N1, N2… são fixos por coluna (`GradingConfig.columnOrder`); coluna nova
    ganha o próximo número e número de coluna apagada não é reaproveitado.
  - Editar nota mantém o mesmo id (`setGrade`); com notas repetidas vale a mais recente
    (`latestGrade`). Nunca gerar id novo ao editar um item sincronizado.
  - Colunas: `buildGradeColumns`. REC paralela fica no período da prova, logo depois dela, e na
    média/soma vale a nota mais alta; 2ª chamada não tem coluna (nota na coluna da original); REC
    trimestral tem coluna mas fica fora da média (falta a fórmula da escola). Na fórmula
    personalizada todas as colunas entram como lançadas.

## Conector do Leciona para o Claude (etapas 1 e 2 prontas)
Servidor MCP remoto no próprio projeto da Vercel: o Claude lê e grava no Leciona. Endereço do
conector: `https://leciona.vercel.app/api/mcp`.

**Onde está**
- `connector/consultas.ts`: leitura (avaliações, conteúdo desde a última avaliação, avaliações
  próximas, turmas e grade, calendário). Reaproveita os utils do app.
- `connector/escrita.ts`: gravação em dois passos (preparar → prévia assinada → confirmar) e
  desfazer. Avaliações (com REC e 2ª chamada pela regra da escola), remarcar/corrigir/apagar
  avaliações, situação, conteúdo de aula, calendário, recessos e eventos.
- `connector/oauth.ts`: login OAuth 2.1 + PKCE; a página de login usa o Firebase Auth e só aceita a
  conta em `LECIONA_EMAIL`. Códigos, tokens, prévias e lotes são JWTs assinados com chave derivada
  da credencial do Firebase Admin (trocar a credencial corta todos os acessos).
- `connector/servidor.ts`: rotas e ferramentas MCP; `connector/producao.ts`: Firebase Admin.
- `api/*.ts`: funções da Vercel; `vercel.json`: `/.well-known/*` → metadados OAuth.
- Testes: `tests/connector*.test.ts` e `tests/conectorPacote.test.ts`.

**Cuidados (aprendidos na prática)**
- As funções importam **`api/_lib/conector.js`, que fica no repositório**: a Vercel prepara as
  funções antes do build. Depois de mudar `connector/` ou `utils/`, rode `npm run build:conector`
  (o teste `conectorPacote` falha se esquecer).
- **Firebase Admin fica na versão 13**: a 14 usa uma biblioteca (jose 6) que não carrega nas
  funções da Vercel. Para reproduzir a Vercel no computador: `node --no-experimental-require-module`.
- Variáveis na Vercel: `FIREBASE_SERVICE_ACCOUNT` (JSON da credencial) e `LECIONA_EMAIL`.
- A prévia de deploy da Vercel é protegida por login; o teste real é em leciona.vercel.app.
- O service worker não intercepta `/api` nem `/.well-known` (`vite.config.ts`).

**Regras da gravação**
- Sempre prévia + confirmação do Cadu; o Claude só grava o plano assinado (vale 1 hora);
  confirmar de novo não duplica; desfazer vale 30 dias e mantém o que foi alterado no app depois.
- Grava como "mais um aparelho": carimbo `_m`, lápides em `_deleted`, transação que grava só os
  campos alterados. Não grava se o item mudou no app depois da prévia.
- **Nunca apaga registro do diário escrito pelo Cadu**: se a aula já tem registro, ele é mantido
  (avaliação) ou o texto novo é acrescentado (conteúdo). Só o registro automático "Avaliação: X"
  (texto exato, sem tarefa) acompanha a avaliação ao remarcar ou apagar.
- Alterar/apagar avaliações é "tudo ou nada": se algo mudou no app depois da prévia, nada é gravado.
  Apagar leva a REC e a 2ª chamada ligadas; avaliação com notas lançadas só se apaga pelo app.
- Feriado municipal ou da escola = recesso no calendário da escola (os nacionais já estão no app).
- Nunca ler nem gravar nomes de alunos, notas, chamada, ocorrências ou observações do diário.

**Cópias de segurança**: `connector/copias.ts` + `api/backup.ts` (Vercel Cron às 6h UTC, ver
`vercel.json`). Uma cópia por dia em `users/{uid}/backups/{AAAA-MM-DD}`, guardadas por 30 dias; só o
servidor acessa (as regras do Firestore bloqueiam o app). O Claude lista e restaura
(`listar_copias`, `preparar_restauracao`, com prévia só em números); antes de restaurar guarda o
estado atual (`antes-de-restaurar-…`), e desfazer volta a ele. `CRON_SECRET` (opcional, na Vercel)
protege a rota da cópia.

**Alertas**: tarefas agendadas no app do Claude (domingo 10h, segunda 6h30, terça 12h45, sexta
12h30) que usam `avaliacoes_proximas` com 7 dias. O texto delas fica no próprio app do Claude.
