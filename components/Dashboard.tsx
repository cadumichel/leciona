import React, { useMemo, useState, useEffect } from 'react';
import { AppData, DayOfWeek, SchoolEvent, LessonLog, Reminder } from '../types';
import { getCurrentTimeInMinutes, parseTimeToMinutes, isHoliday, getHolidayName, getShortWeekDay, getDayMonth } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';
import { getLessonDisplayItems, isLessonBlocked, deriveStatsFromLessons } from '../utils/lessonStats';
import {
  Clock,
  ArrowRight,
  CalendarDays,
  History,
  ChevronLeft,
  ChevronRight,
  Bell,
  FileCheck,
  Quote as QuoteIcon,
  Sparkles,
  Calendar as CalendarIcon,
  Coffee,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Calendar,
  MapPin,
  BookOpen,
  Users,
  Layers,
  School as SchoolIcon,
  DollarSign,
  Moon,
  Sunset,
  BookCheck,
  Feather,
  Armchair,
  UserCheck,
  Sun,
  Heart,
  Palmtree,
  Compass,
  Palette,
  Bike,
  Camera,
  BatteryCharging
} from 'lucide-react';

interface DashboardProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  onNavigateToLesson: (schedule: any, date: string) => void;
  onNavigateToReminders: () => void;
  onNavigateToPendencies: () => void;
  onNavigateToAssessments: () => void;
  onNavigateToAgenda: () => void;
}

const QUOTES = [
  "A educação é a arma mais poderosa que você pode usar para mudar o mundo. – Nelson Mandela",
  "Educação não transforma o mundo, educação muda as pessoas. Pessoas transformam o mundo. – Paulo Freire",
  "Feliz aquele que transfere o que sabe e aprende o que ensina. – Cora Coralina",
  "Ensinar é um exercício de imortalidade. O professor não morre jamais. – Rubem Alves",
  "A educação é o nosso passaporte para o futuro, pois o amanhã pertence às pessoas que se preparam hoje. – Malcolm X",
  "Educai as crianças, para que não seja preciso punir os adultos. – Pitágoras",
  "A educação exige os maiores cuidados, porque influi sobre toda a vida. – Sêneca",
  "As nações marcham para sua grandeza no mesmo passo que avança sua educação. – Simón Bolívar",
  "É na educação que está o segredo do aperfeiçoamento da humanidade. – Aristóteles",
  "A educação abre asas para voos que jamais imaginamos. – Provérbio",
  "Só a educação liberta. – Epicteto",
  "A educação é um processo social, é desenvolvimento. Não é a preparação para a vida, é a própria vida. – John Dewey",
  "Educar é realizar a mais bela e complexa arte da inteligência. Educar é acreditar na vida e ter esperança no futuro. – Augusto Cury",
  "A educação alimenta a confiança. A confiança alimenta a esperança. A esperança alimenta a paz. – Confúcio",
  "O conhecimento abre portas que a ignorância mantém fechadas. – Provérbio",
  "O conhecimento serve para encantar as pessoas, não para humilhá-las. – Mario Sergio Cortella",
  "Educar é impregnar de sentido o que fazemos a cada instante. – Paulo Freire",
  "A educação é a chave para desbloquear a porta dourada da liberdade. – George Washington Carver",
  "O objetivo da educação é transformar espelhos em janelas. – Sydney J. Harris",
  "A educação é a ignição da mente. – Sócrates",
  "Vamos pegar nossos livros e canetas. Elas são nossas armas mais poderosas. – Malala Yousafzai",
  "Educação nunca foi despesa. Busquei investir nela em todos os lugares que estive. – Luther King",
  "Me movo como educador porque amo o que faço e acredito no potencial humano. – Mario Sergio Cortella",
  "Aprender sem refletir é desperdiçar a energia. – Confúcio",
  "A educação constrói pontes para o futuro brilhante de todos. – Provérbio",
  "A primeira fase do saber é amar os nossos professores. – Provérbio chinês",
  "A educação é a capacidade de ouvir quase tudo sem perder a paciência ou a autoestima. – Robert Frost",
  "A educação não é a resposta para a pergunta. A educação é o meio de encontrar a resposta para todas as perguntas. – William Allin",
  "Na construção de nosso conhecimento, os livros são os tijolos e os professores são os pedreiros. – Jonathan Fonseca Fogo",
  "É preciso que a leitura seja um ato de amor. – Paulo Freire",
  "O professor medíocre conta. O bom professor explica. O professor superior demonstra. O grande professor inspira. – William Arthur Ward",
  "Um professor pode inspirar esperança, provocar a imaginação e instigar o amor pelo aprendizado. – Brad Henry",
  "O professor se liga à eternidade. – Rubem Alves",
  "Eu não posso ensinar nada a ninguém, eu só posso fazê-lo pensar. – Sócrates",
  "Um professor é uma bússola que ativa os ímãs de curiosidade, conhecimento e sabedoria nos alunos. – Ever Garrison",
  "Quem ousa ensinar não deve deixar de aprender. – John C. Dana",
  "Bons professores são inestimáveis. Eles inspiram e entretêm, e você acaba aprendendo muita coisa mesmo sem se dar conta disso. – Nicholas Sparks",
  "O maior sinal de sucesso para um professor é poder dizer: 'As crianças estão agora trabalhando como se eu não existisse'. – Maria Montessori",
  "O papel supremo do professor é despertar alegria na expressão criativa e no conhecimento. – Albert Einstein",
  "O ensino é a arte de ajudar os alunos a descobrir o que eles já sabem. – Anatole France",
  "Os professores, que educam as crianças, merecem mais honra que os pais, que meramente as deram à luz. – Aristóteles",
  "Um mestre conduz, conquista e cativa com confiança e inspiração. – A. Shakti",
  "O conhecimento verdadeiro consiste em saber o que se sabe e o que não se sabe. – Confúcio",
  "Tenho orgulho de ser professor. Não apenas por ensinar conteúdos, mas por inspirar sonhos. – Provérbio educacional",
  "Ser professor é plantar sementes invisíveis que florescerão em lugares maravilhosos. – Provérbio educacional",
  "Ensinar é um chamado. É doar-se, acreditar e persistir com coragem. – Provérbio educacional",
  "Há pessoas que simplesmente aparecem em nossas vidas e nos marcam para sempre. – Cecília Meireles",
  "A função da educação é ensinar a pensar intensamente e criticamente com inteligência e caráter. – Martin Luther King Jr.",
  "O professor constrói pontes entre o saber e o aprendiz com paciência e dedicação. – Provérbio educacional",
  "Para um verdadeiro professor, a maior alegria é ver seus alunos crescerem e brilharem. – Provérbio educacional",
  "Educar é antes de tudo um compromisso de honra e amor. – Provérbio educacional",
  "Um bom professor inspira esperança e amor pela aprendizagem. – Brad Henry",
  "Os professores fazem um impacto duradouro e maravilhoso na vida dos alunos. – Solomon Ortiz",
  "Professores mudam vidas com a mistura certa de giz e desafios criativos. – Joyce Meyer",
  "É o professor que faz a verdadeira diferença na educação. – Michael Morpurgo",
  "Todos lembramos dos professores que marcaram nossas vidas. – Sidney Hook",
  "Professores que amam ensinar fazem as crianças amarem aprender. – Robert John Meehan",
  "Melhor que mil dias de estudo é um dia com um grande professor. – Provérbio japonês",
  "Os melhores professores mostram onde olhar e inspiram a descoberta. – Alexandra K. Trenfor",
  "A mente é um fogo a ser aceso com entusiasmo e curiosidade. – Plutarco",
  "Diga-me e eu esqueço. Ensine-me e eu lembro. Envolva-me e eu aprendo. – Benjamin Franklin",
  "A mente não é um vaso a ser cheio, mas um fogo a ser aceso. – Plutarco",
  "Não posso ensinar nada a ninguém; só posso fazê-lo pensar. – Sócrates",
  "Os melhores professores mostram onde olhar, mas deixam você descobrir. – Alexandra K. Trenfor",
  "A arte de ensinar é a arte de assistir à descoberta. – Mark Van Doren",
  "A melhor educação é despertada nos alunos com entusiasmo. – Gerald Belcher",
  "O educador moderno irriga desertos e faz florescer o impossível. – C. S. Lewis",
  "A educação melhora vidas e deixa o mundo mais bonito. – Marian Wright Edelman",
  "Só os educados são verdadeiramente livres para sonhar. – Epicteto",
  "Cada aula é uma oportunidade de iluminar mentes. – Provérbio educacional",
  "A educação desperta a luz interior de cada pessoa. – Sócrates",
  "Quem ensina com alegria, aprende com entusiasmo. – Provérbio",
  "Quem ensina aprende duas vezes com prazer. – Provérbio",
  "O bom aluno é aquele que ama aprender todos os dias. – Provérbio educacional",
  "Ensinar é deixar uma marca eterna de luz. – Provérbio educacional",
  "O professor é o coração pulsante da educação. – Sidney Hook",
  "Tudo vale a pena se a alma não é pequena. – Fernando Pessoa",
  "Toda criança é um artista. O problema é permanecer artista ao crescer. – Pablo Picasso",
  "A inspiração existe, mas ela precisa te encontrar trabalhando. – Pablo Picasso",
  "Criatividade é permitir-se errar e arte é saber quais erros manter. – Scott Adams",
  "O papel do professor é despertar alegria na criação. – Albert Einstein",
  "Ame a arte em você, não você na arte. – Constantin Stanislavski",
  "O essencial é invisível aos olhos, mas visível ao coração. – Antoine de Saint-Exupéry",
  "Comece de onde você está. Use o que você tem. Faça o que você pode. – Arthur Ashe",
  "A persistência é o caminho do êxito. – Charles Chaplin",
  "Você nunca é velho demais para definir outra meta ou sonhar um novo sonho. – C.S. Lewis",
  "A melhor maneira de prever o futuro é criá-lo. – Peter Drucker",
  "Não importa o quão devagar você vá, desde que você não pare. – Confúcio",
  "A vida se contrai e se expande proporcionalmente à coragem do indivíduo. – Anaïs Nin",
  "Viver é desenhar sem borracha. – Millôr Fernandes",
  "Para viajar basta existir. – Fernando Pessoa",
  "A gratidão é a memória do coração. – Antístenes",
  "A história será gentil comigo, pois pretendo escrevê-la. – Winston Churchill",
  "O professor medíocre conta. O bom professor explica. O professor superior demonstra. O grande professor inspira. – William Arthur Ward"
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  test: 'Prova',
  work: 'Trabalho',
  meeting: 'Reunião',
  festivity: 'Evento',
  trip: 'Passeio',
  material: 'Material',
  other: 'Outro'
};

const WEEKDAY_NIGHT_MESSAGES = [
  { title: "Missão Cumprida", subtitle: "Recarregue as energias para inspirar amanhã.", icon: Moon },
  { title: "Bom Descanso", subtitle: "Grandes aulas pedem mentes descansadas.", icon: Coffee },
  { title: "Pausa Merecida", subtitle: "O dia foi produtivo. Aproveite sua noite.", icon: Sunset },
  { title: "Página Virada", subtitle: "O capítulo de hoje foi concluído. Descanse.", icon: BookCheck },
  { title: "Desacelere", subtitle: "Sua mente é seu recurso mais valioso. Cuide dela.", icon: Feather },
  { title: "Modo Zen", subtitle: "Feche as abas. A escola fica para amanhã.", icon: Armchair },
  { title: "Equilíbrio", subtitle: "Você cuidou de muitos hoje. Agora cuide de você.", icon: UserCheck }
];

const FRIDAY_NIGHT_MESSAGES = [
  { title: "Bom Fim de Semana", subtitle: "Educar é jornada, mas o descanso é a base. Tenha um fim de semana revigorante!", icon: Sunset },
  { title: "Aproveite", subtitle: "O planejamento mais importante deste fim de semana é o seu bem-estar. Aproveite cada minuto!", icon: Heart },
  { title: "Descanse", subtitle: "O plano de aula mais valioso hoje é não ter plano nenhum. Bom descanso, professor!", icon: Coffee },
  { title: "Renove as Energias", subtitle: "Prioridade do cronograma: silenciar o despertador e renovar as energias. Bom fim de semana!", icon: BatteryCharging },
  { title: "Você Merece", subtitle: "Que o seu fim de semana seja um capítulo de pausa e alegria na sua história. Você merece!", icon: Sparkles }
];

const WEEKEND_MESSAGES = [
  { title: "Modo Fim de Semana", subtitle: "Tempo de viver novas histórias e recarregar.", icon: Sun },
  { title: "Você faz a diferença", subtitle: "Agora é hora de cuidar de você. Aproveite!", icon: Heart },
  { title: "Tempo de Qualidade", subtitle: "Desconecte para se reconectar com o que te faz bem.", icon: Palmtree },
  { title: "Explore o Mundo", subtitle: "Novas experiências geram novas aulas. Vá explorar!", icon: Compass },
  { title: "Alimente a Alma", subtitle: "Arte, música ou silêncio. Faça o que te preenche.", icon: Palette },
  { title: "Liberdade", subtitle: "Sem horários, sem sinais. O tempo hoje é todo seu.", icon: Bike },
  { title: "Inspire-se", subtitle: "A vida acontece fora da sala de aula. Vá vivê-la!", icon: Camera }
];

const Dashboard: React.FC<DashboardProps> = ({ data, onUpdateData, onNavigateToLesson, onNavigateToReminders, onNavigateToPendencies, onNavigateToAssessments, onNavigateToAgenda }) => {
  const [currentTime, setCurrentTime] = useState(getCurrentTimeInMinutes());
  const [dashMonth, setDashMonth] = useState(new Date());
  const [dailyQuote, setDailyQuote] = useState("");

  const todayDateStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const today = new Date().getDay();

  // Lógica de Frase do Dia (Sem repetição)
  useEffect(() => {
    const storageKey = 'leciona_quotes_state';
    const savedState = localStorage.getItem(storageKey);
    let state = savedState ? JSON.parse(savedState) : { lastDate: '', currentIndex: -1, shuffled: [] };

    if (state.lastDate !== todayDateStr) {
      if (state.currentIndex === -1 || state.currentIndex >= QUOTES.length - 1) {
        const indices = Array.from({ length: QUOTES.length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        state.shuffled = indices;
        state.currentIndex = 0;
      } else {
        state.currentIndex += 1;
      }
      state.lastDate = todayDateStr;
      localStorage.setItem(storageKey, JSON.stringify(state));
    }

    setDailyQuote(QUOTES[state.shuffled[state.currentIndex]]);
  }, [todayDateStr]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(getCurrentTimeInMinutes()), 60000);
    return () => clearInterval(timer);
  }, []);



  const pendingCount = useMemo(() => {
    const now = new Date();
    const endStr = new Date().toLocaleDateString('en-CA');
    const start = new Date(now);
    start.setFullYear(now.getFullYear() - 1);
    const startStr = start.toLocaleDateString('en-CA');

    const items = getLessonDisplayItems(data, {
      start: startStr,
      end: endStr,
      schoolId: 'all',
      classId: 'all',
      showWithContent: true,
      showWithoutContent: true
    });

    return deriveStatsFromLessons(items).pending;
  }, [data]);

  const overduePayments = useMemo(() => {
    if (!data.settings.isPrivateTeacher) return [];

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthStr = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const overdueList: { studentName: string; month: string }[] = [];

    data.students.forEach(student => {
      if (!student.paymentConfig?.enabled || student.paymentConfig.model !== 'monthly') return;

      const dueDay = student.paymentConfig.dueDay;

      // Check Current Month if past due day
      if (currentDay > dueDay) {
        const hasPayment = student.payments?.some(p =>
          p.date.startsWith(currentMonthStr) || p.referenceData?.includes(currentMonthStr)
        );
        if (!hasPayment) overdueList.push({ studentName: student.name, month: 'Mês Atual' });
      }

      // Check Previous Month (always checks if not paid)
      const hasPrevPayment = student.payments?.some(p =>
        p.date.startsWith(previousMonthStr) || p.referenceData?.includes(previousMonthStr)
      );
      if (!hasPrevPayment) {
        // Only add if not already covered (simplified logic: show oldest pending or just list all?)
        // Let's just list relevant ones. If current is overdue, maybe previous is too.
        // To avoid duplicates in count, we can just count students or debts.
        // Let's list specific debts.
        overdueList.push({ studentName: student.name, month: 'Mês Anterior' });
      }
    });

    return overdueList;
  }, [data.students, data.settings.isPrivateTeacher, todayDateStr]);

  const sortedTodaySchedules = useMemo(() => {
    // FIX: Use versioned schedules + Flexible Day Check
    const dailySchedules = getSchedulesForDate(data, todayDateStr);

    const schoolSchedules = dailySchedules.filter(s => {
      // Check if this specific lesson is blocked (Recess/Holiday/Event)
      if (isLessonBlocked(data, todayDateStr, s.schoolId, s.shiftId, s.classId)) return false;
      return Number(s.dayOfWeek) === today;
    }).map(s => {
      const school = data.schools.find(sc => sc.id === s.schoolId);
      const shift = school?.shifts.find(sh => sh.id === s.shiftId);
      const slot = shift?.slots.find(sl => sl.id === s.slotId);
      return {
        type: 'school' as const, schedule: s, school, slot,
        startTime: slot?.startTime || '00:00', endTime: slot?.endTime || '00:00'
      };
    }).filter(item => item.school && !item.school.deleted);

    const privateSchedules: any[] = [];
    if (data.settings.isPrivateTeacher) {
      data.students.forEach(student => {
        // Check global block for student (e.g. holiday)
        if (isLessonBlocked(data, todayDateStr, student.id)) return;

        student.schedules.filter(ps => Number(ps.dayOfWeek) === today).forEach(ps => {
          privateSchedules.push({ type: 'private' as const, student, schedule: ps, startTime: ps.startTime, endTime: ps.endTime });
        });
      });
    }

    return [...schoolSchedules, ...privateSchedules].sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
  }, [data.schedules, data.students, data.settings.isPrivateTeacher, today, todayDateStr, data]);

  const getSlotStartTime = useMemo(() => (schoolId: string, slotId: string) => {
    const school = data.schools.find(s => s.id === schoolId);
    if (!school) {
      const student = data.students.find(st => st.id === schoolId);
      if (student) {
        const schedule = student.schedules.find(s => s.id === slotId);
        return schedule ? parseTimeToMinutes(schedule.startTime) : 0;
      }
      return 0;
    }
    for (const shift of school.shifts) {
      const slot = shift.slots.find(s => s.id === slotId);
      if (slot) return parseTimeToMinutes(slot.startTime);
    }
    return 0;
  }, [data.schools, data.students]);

  const activityInfo = useMemo(() => {
    const activeIndex = sortedTodaySchedules.findIndex(item => {
      const start = parseTimeToMinutes(item.startTime);
      const end = parseTimeToMinutes(item.endTime);
      return currentTime >= start && currentTime < end;
    });

    if (activeIndex === -1) return null;

    const current = sortedTodaySchedules[activeIndex];
    const currentStartMin = parseTimeToMinutes(current.startTime);
    const next = sortedTodaySchedules[activeIndex + 1] || null;
    const isLast = activeIndex === sortedTodaySchedules.length - 1;

    const classId = current.type === 'school' ? current.schedule.classId : current.student?.name;
    const instId = current.type === 'school' ? current.school?.id : current.student?.id;

    const retrospective = data.logs
      .filter(l => {
        if (l.classId !== classId) return false;
        if (l.schoolId !== instId && l.studentId !== instId) return false;

        const logDatePart = l.date.split('T')[0];

        if (logDatePart > todayDateStr) return false;
        if (logDatePart < todayDateStr) return true;

        if (logDatePart === todayDateStr) {
          const logSlotStart = getSlotStartTime(l.schoolId || l.studentId || '', l.slotId);
          return logSlotStart < currentStartMin;
        }
        return false;
      })
      .sort((a, b) => {
        const dateA = a.date.split('T')[0];
        const dateB = b.date.split('T')[0];
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        const timeA = getSlotStartTime(a.schoolId || a.studentId || '', a.slotId);
        const timeB = getSlotStartTime(b.schoolId || b.studentId || '', b.slotId);
        return timeB - timeA;
      })[0];

    return { current, next, isLast, retrospective };
  }, [sortedTodaySchedules, currentTime, data.logs, todayDateStr, getSlotStartTime]);

  const nextGlobalActivity = useMemo(() => {
    if (activityInfo) return null;

    const laterToday = sortedTodaySchedules.find(item => parseTimeToMinutes(item.startTime) > currentTime);
    if (laterToday) return { ...laterToday, dateLabel: 'Hoje' };

    const now = new Date();
    for (let i = 1; i <= 15; i++) {
      const checkDate = new Date();
      checkDate.setDate(now.getDate() + i);
      const dateStr = checkDate.toLocaleDateString('en-CA');
      const dayOfWeek = checkDate.getDay() as DayOfWeek;

      if (isHoliday(checkDate)) continue;

      const daySchedules: any[] = [];
      // FIX: Use versioned schedules + Flexible check
      const versionedSchedules = getSchedulesForDate(data, dateStr);

      versionedSchedules.filter(s => Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window').forEach(s => {
        if (isLessonBlocked(data, dateStr, s.schoolId, s.shiftId, s.classId)) return;

        const school = data.schools.find(sc => sc.id === s.schoolId);
        const slot = school?.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);

        if (slot && school && !school.deleted) {
          daySchedules.push({
            type: 'school', schedule: s, school, slot,
            startTime: slot.startTime, endTime: slot.endTime
          });
        }
      });

      if (data.settings.isPrivateTeacher) {
        data.students.forEach(st => {
          if (dateStr < st.startDate) return;
          if (isLessonBlocked(data, dateStr, st.id)) return;
          st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
            daySchedules.push({ type: 'private', student: st, schedule: ps, startTime: ps.startTime, endTime: ps.endTime });
          });
        });
      }

      if (daySchedules.length > 0) {
        daySchedules.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
        const dateLabel = i === 1 ? 'Amanhã' : new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
        return { ...daySchedules[0], dateLabel };
      }
    }
    return null;
  }, [activityInfo, sortedTodaySchedules, currentTime, data]);

  const upcomingAssessments = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const limit = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

    return data.events
      .filter(e => {
        const eDate = new Date(e.date);
        const school = data.schools.find(s => s.id === e.schoolId);
        return (e.type === 'test' || e.type === 'work') && eDate >= now && eDate <= limit && school && !school.deleted;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.events]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const limit = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

    return data.events
      .filter(e => {
        const eDate = new Date(e.date);
        const school = data.schools.find(s => s.id === e.schoolId);
        return !['test', 'work'].includes(e.type) && eDate >= now && eDate <= limit && school && !school.deleted;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.events]);

  const renderDashboardCalendar = () => {
    const year = dashMonth.getFullYear();
    const month = dashMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const days = [];

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDay; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dObj = new Date(dateStr + 'T00:00:00');
      const dayEvents = data.events.filter(e => {
        const school = data.schools.find(s => s.id === e.schoolId);
        return e.date.startsWith(dateStr) && school && !school.deleted;
      });
      const dayReminders = data.reminders.filter(r => {
        if (r.date !== dateStr) return false;
        if (r.schoolId) {
          const s = data.schools.find(sc => sc.id === r.schoolId);
          if (!s || s.deleted) return false;
        }
        return true;
      });
      const holidayName = getHolidayName(dObj);

      let recessInfo = null;
      data.calendars.forEach(c => {
        if (c.midYearBreak.start && dateStr >= c.midYearBreak.start && dateStr <= c.midYearBreak.end) {
          recessInfo = { name: 'Recesso Escolar' };
        }
        const extra = c.extraRecesses?.find(r => r.date === dateStr);
        if (extra) recessInfo = extra;
      });

      days.push({ day: i, dateStr, dObj, events: dayEvents, reminders: dayReminders, holidayName, recessInfo });
    }

    return (
      <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <div className="flex items-center gap-2">
            <CalendarIcon className="text-primary" size={16} />
            <h4 className="text-[10px] md:text-xs font-black text-slate-800 dark:text-white uppercase tracking-tight">{dashMonth.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</h4>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setDashMonth(new Date(year, month - 1))} className="p-1 md:p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-all border border-slate-100 dark:border-slate-800"><ChevronLeft size={14} /></button>
            <button onClick={() => setDashMonth(new Date(year, month + 1))} className="p-1 md:p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-all border border-slate-100 dark:border-slate-800"><ChevronRight size={14} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
            <div key={`${d}-${i}`} className="text-center text-[7px] md:text-[8px] font-black text-slate-400 py-1 uppercase tracking-tight">{d}</div>
          ))}
          {days.map((d, i) => {
            if (!d) return <div key={i} />;
            const isToday = d.dateStr === todayDateStr;
            const hasReminder = d.reminders.length > 0;

            let cellBg = isToday ? 'bg-primary/5 border-primary ring-1 ring-primary/20' : 'bg-slate-50/50 dark:bg-slate-800/30 border-transparent';
            if (d.holidayName || d.recessInfo) cellBg = 'bg-pink-50 dark:bg-pink-900/10 border-pink-100 dark:border-pink-900/20';

            return (
              <div key={i} className={`aspect-square rounded-lg flex flex-col items-center justify-center relative border transition-all ${cellBg}`}>
                <span className={`text-[9px] md:text-[10px] font-black ${isToday ? 'text-primary' : (d.holidayName || d.recessInfo) ? 'text-pink-600' : 'text-slate-500'}`}>{d.day}</span>
                <div className="flex gap-[1px] md:gap-0.5 mt-0.5">
                  {d.events.slice(0, 3).map((ev, idx) => {
                    const school = data.schools.find(s => s.id === ev.schoolId);
                    return (
                      <div key={idx} className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full" style={{ backgroundColor: school ? school.color : '#f97316' }} />
                    );
                  })}
                  {hasReminder && <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-amber-400" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getEventScope = (event: SchoolEvent) => {
    if (event.classId) return `Turma ${event.classId}`;
    if (event.slotId) return `Turno/Horário`;
    return 'Geral';
  };

  const activityContent = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 (Dom) a 6 (Sáb)
    const dayOfMonth = now.getDate();

    // Lógica 1: Sexta-feira Pós-Aula (Sextou!)
    if (day === 5) {
      let lastClassEnd = 18 * 60; // Default 18:00

      if (sortedTodaySchedules.length > 0) {
        const last = sortedTodaySchedules[sortedTodaySchedules.length - 1];
        lastClassEnd = parseTimeToMinutes(last.endTime);
      }

      if (currentTime >= lastClassEnd) {
        const index = dayOfMonth % FRIDAY_NIGHT_MESSAGES.length;
        return FRIDAY_NIGHT_MESSAGES[index];
      }
    }

    // Lógica 2: Fim de Semana (Sáb/Dom)
    if (day === 0 || day === 6) {
      const index = dayOfMonth % WEEKEND_MESSAGES.length;
      return WEEKEND_MESSAGES[index];
    }

    // Lógica 3: Dia de Semana - Noite (Após 18h)
    if (hour >= 18) {
      const index = dayOfMonth % WEEKDAY_NIGHT_MESSAGES.length;
      return WEEKDAY_NIGHT_MESSAGES[index];
    }

    // Lógica 4: Padrão (Horário comercial vago) - Mantém o atual
    return {
      title: "Pausa na Rotina",
      subtitle: "Nenhum horário em andamento agora",
      icon: Coffee
    };
  }, [sortedTodaySchedules, currentTime]);

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-lg md:text-3xl font-black text-slate-800 dark:text-white tracking-tight leading-none">
            Olá, {data.profile.title || 'Prof.'} {data.profile.name || 'Docente'}!
          </h1>
          <p className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-tight mt-1 md:mt-2">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 bg-white dark:bg-slate-900 px-3 py-1.5 md:px-4 md:py-2 rounded-lg border border-slate-100 dark:border-slate-800 shadow-sm shrink-0 w-fit">
          <Sparkles className="text-primary animate-pulse w-3 h-3 md:w-4 md:h-4" />
          <span className="text-[8px] md:text-[9px] font-black uppercase tracking-tight text-slate-500">Inspirado para hoje</span>
        </div>
      </div>

      {pendingCount > 0 && !data.settings.hideUnregisteredClassesOnDashboard && (
        <button onClick={onNavigateToPendencies} className="w-full flex items-center justify-between p-3 md:p-4 rounded-xl bg-red-600 text-white shadow-lg shadow-red-200 dark:shadow-red-900/20 hover:scale-[1.01] transition-transform animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center bg-white/20">
              <AlertTriangle size={18} className="md:w-[20px] md:h-[20px]" />
            </div>
            <div className="text-left">
              <span className="text-[8px] md:text-[9px] font-black uppercase block mb-0.5 text-white/80">Atenção Necessária</span>
              <p className="text-[10px] md:text-xs font-black uppercase text-white">Você tem {pendingCount} registros pendentes.</p>
            </div>
          </div>
          <ChevronRight size={18} className="md:w-[20px] md:h-[20px]" />
        </button>
      )}

      {overduePayments.length > 0 && (
        <div className="w-full flex items-center justify-between p-3 md:p-4 rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 hover:scale-[1.01] transition-transform animate-in slide-in-from-top-4 cursor-pointer">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center bg-white/20">
              <DollarSign size={18} className="md:w-[20px] md:h-[20px]" />
            </div>
            <div className="text-left">
              <span className="text-[8px] md:text-[9px] font-black uppercase block mb-0.5 text-white/80">Financeiro</span>
              <p className="text-[10px] md:text-xs font-black uppercase text-white">
                {overduePayments.length} pagamentos em atraso ({overduePayments[0].studentName}...)
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="md:w-[20px] md:h-[20px]" />
        </div>
      )}

      {data.settings.showDailyQuote && (
        <div className="bg-primary/5 dark:bg-primary/10 border-2 border-dashed border-primary/20 p-4 md:p-5 rounded-xl relative overflow-hidden">
          <div className="absolute -top-4 -left-4 md:-top-6 md:-left-6 opacity-5 pointer-events-none"><QuoteIcon size={60} className="md:w-[80px] md:h-[80px]" /></div>
          <p className="text-xs md:text-base font-bold text-primary dark:text-primary-light italic leading-relaxed relative z-10">"{dailyQuote}"</p>
        </div>
      )
      }

      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
            <h3 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-tight mb-4 md:mb-6 flex items-center gap-2"><Clock className="text-primary w-3 h-3 md:w-[14px] md:h-[14px]" /> Atividade Agora</h3>
            {activityInfo ? (
              <div className="space-y-3 md:space-y-4">
                {/* CARTÃO PRINCIPAL DA AULA ATUAL */}
                <button onClick={() => onNavigateToLesson(activityInfo.current.schedule, todayDateStr)} className="w-full text-left p-4 md:p-6 rounded-xl transition-all hover:scale-[1.01] shadow-xl border-2 relative overflow-hidden group" style={{ backgroundColor: (activityInfo.current.type === 'school' ? activityInfo.current.school?.color : activityInfo.current.student?.color) + '15', borderColor: (activityInfo.current.type === 'school' ? activityInfo.current.school?.color : activityInfo.current.student?.color) + '40' }}>
                  <div className="absolute top-0 right-0 bg-white/50 dark:bg-black/20 px-3 py-1.5 md:px-4 md:py-2 rounded-bl-lg backdrop-blur-sm border-l border-b border-white/20">
                    <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest" style={{ color: activityInfo.current.type === 'school' ? activityInfo.current.school?.color : activityInfo.current.student?.color }}>
                      {activityInfo.current.slot?.label || 'Em andamento'}
                    </span>
                  </div>

                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-2 md:mb-4">
                      <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm md:text-lg font-black" style={{ color: activityInfo.current.type === 'school' ? activityInfo.current.school?.color : activityInfo.current.student?.color }}>
                        {activityInfo.current.type === 'school' ? activityInfo.current.school?.name[0] : <BookOpen size={16} />}
                      </div>
                      <div>
                        <p className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">
                          {activityInfo.current.type === 'school' ? activityInfo.current.school?.name : 'Aula Particular'}
                        </p>
                        <p className="text-[9px] md:text-[10px] font-bold text-slate-600 dark:text-slate-300">
                          {activityInfo.current.startTime} - {activityInfo.current.endTime}
                        </p>
                      </div>
                    </div>

                    <h4 className="text-2xl md:text-4xl font-black text-slate-900 dark:text-white uppercase leading-none tracking-tighter mb-3 md:mb-4">
                      {activityInfo.current.type === 'school'
                        ? (activityInfo.current.schedule.classId === 'window' ? 'Janela / Livre' : activityInfo.current.schedule.classId)
                        : activityInfo.current.student.name}
                    </h4>

                    <div className="flex items-center gap-2 text-[8px] md:text-[9px] font-black uppercase tracking-widest text-primary/80 group-hover:text-primary transition-colors">
                      <span>Toque para registrar aula</span>
                      <ArrowRight size={10} className="md:w-3 md:h-3" />
                    </div>
                  </div>
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  <div className="p-3 md:p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-center">
                    <div className="flex items-center gap-2 mb-1 md:mb-2 text-slate-400">
                      <History size={10} className="md:w-3 md:h-3" />
                      <span className="text-[7px] md:text-[8px] font-black uppercase tracking-tight">Aula Anterior</span>
                    </div>
                    {activityInfo.retrospective ? (
                      <div className="space-y-1">
                        <p className="text-[9px] md:text-[10px] font-bold text-slate-600 dark:text-slate-300 italic line-clamp-2">
                          <span className="text-slate-400 not-italic">Conteúdo: </span>"{activityInfo.retrospective.subject}"
                        </p>
                        {activityInfo.retrospective.homework && (
                          <p className="text-[9px] md:text-[10px] font-bold text-blue-600 dark:text-blue-400 italic line-clamp-1">
                            <span className="text-slate-400 not-italic">Tarefa: </span>{activityInfo.retrospective.homework}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase">Sem registros anteriores.</p>
                    )}
                  </div>

                  <div className="p-3 md:p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-center">
                    <div className="flex items-center gap-2 mb-1 md:mb-2 text-slate-400">
                      <ArrowRight size={10} className="md:w-3 md:h-3" />
                      <span className="text-[7px] md:text-[8px] font-black uppercase tracking-tight">Próxima Aula</span>
                    </div>
                    {activityInfo.isLast ? (
                      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                        <CheckCircle2 size={12} className="md:w-[14px] md:h-[14px]" />
                        <span className="text-[9px] md:text-[10px] font-black uppercase tracking-tight">Fim do expediente! 🎉</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] md:text-xs font-black text-primary uppercase">
                            {activityInfo.next?.type === 'school'
                              ? (activityInfo.next.schedule.classId === 'window' ? 'Janela / Livre' : activityInfo.next.schedule.classId)
                              : activityInfo.next.student?.name}
                          </span>
                          <span className="text-[8px] md:text-[9px] font-bold text-slate-500 bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600">{activityInfo.next?.startTime}</span>
                        </div>
                        {activityInfo.next?.type === 'school' && activityInfo.next.school?.id !== (activityInfo.current.type === 'school' ? activityInfo.current.school?.id : '') && (
                          <span className="text-[8px] md:text-[9px] font-black text-orange-500 uppercase flex items-center gap-1"><MapPin size={9} /> {activityInfo.next.school?.name}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800/30 p-4 md:p-6 rounded-xl text-center border-4 border-dashed border-slate-200 dark:border-slate-800">
                <activityContent.icon className="mx-auto text-slate-400 mb-2 md:mb-3" size={24} />
                <p className="text-slate-500 font-black uppercase text-[9px] md:text-[10px] tracking-tight">{activityContent.title}</p>
                <p className="text-slate-500 font-bold text-[8px] md:text-[9px] uppercase mt-1">{activityContent.subtitle}</p>

                {nextGlobalActivity && (
                  <div className="mt-4 md:mt-5 pt-4 md:pt-5 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-[8px] md:text-[9px] font-black text-blue-500 uppercase tracking-tight mb-2 md:mb-3 flex items-center justify-center gap-2">
                      <Calendar size={10} className="md:w-3 md:h-3" /> Próximo Compromisso: <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 px-2 py-0.5 rounded-lg">{nextGlobalActivity.dateLabel}</span>
                    </p>
                    <div className="flex flex-col items-center gap-2">
                      <div className="inline-flex items-center gap-3 px-3 py-1.5 md:px-4 md:py-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 max-w-full min-w-0">
                        <span className="text-[10px] md:text-xs font-black text-slate-700 dark:text-slate-200 shrink-0">{nextGlobalActivity.startTime}</span>
                        <div className="w-1 h-1 bg-slate-300 rounded-full shrink-0" />
                        <div className="text-left min-w-0 overflow-hidden">
                          <p className="text-[9px] md:text-[10px] font-black uppercase text-primary truncate">
                            {nextGlobalActivity.type === 'school'
                              ? (nextGlobalActivity.schedule.classId === 'window' ? 'Janela' : nextGlobalActivity.schedule.classId)
                              : nextGlobalActivity.student.name}
                          </p>
                        </div>
                      </div>
                      {nextGlobalActivity.type === 'school' && (
                        <p className="text-[8px] md:text-[9px] font-black text-orange-500 uppercase flex items-center gap-1"><MapPin size={9} /> {nextGlobalActivity.school.name}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
              <h3 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-tight mb-3 md:mb-4 flex items-center gap-2"><FileCheck className="text-primary w-3 h-3 md:w-[14px] md:h-[14px]" /> Avaliações (15d)</h3>
              <div className="space-y-2 md:space-y-3 flex-1">
                {upcomingAssessments.length > 0 ? upcomingAssessments.map((event, idx) => {
                  const school = data.schools.find(s => s.id === event.schoolId);
                  const color = school?.color || '#3b82f6';

                  return (
                    <div key={idx} onClick={onNavigateToAssessments} className="flex items-center gap-3 p-2.5 md:p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800 cursor-pointer hover:scale-[1.02] transition-transform" style={{ borderColor: color + '30', backgroundColor: color + '05' }}>
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg flex flex-col items-center justify-center shrink-0 border-b-2" style={{ backgroundColor: color + '15', color: color, borderColor: color + '30' }}>
                        <span className="text-[7px] md:text-[8px] font-black uppercase leading-none mb-0.5">{getShortWeekDay(event.date)}</span>
                        <span className="text-[10px] md:text-xs font-black leading-none">{getDayMonth(event.date)}</span>
                      </div>
                      <div className="flex-1 overflow-hidden min-w-0">
                        <h4 className="text-[9px] md:text-[10px] font-black text-slate-800 dark:text-white uppercase truncate">{event.title}</h4>
                        <div className="flex flex-col min-w-0">
                          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter truncate">
                            {event.type === 'test' ? 'Prova' : 'Trabalho'} • {(() => {
                              // Lookup class name from ID
                              const schoolClass = school?.classes.find(c =>
                                (typeof c === 'string' ? c : c.id) === event.classId ||
                                (typeof c === 'string' ? c : c.name) === event.classId
                              );
                              return schoolClass ? (typeof schoolClass === 'string' ? schoolClass : schoolClass.name) : event.classId;
                            })()}
                          </p>
                          <p className="text-[7px] font-black uppercase truncate mt-0.5" style={{ color: color }}>{school?.name}</p>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-6 md:py-8 text-center flex flex-col items-center justify-center h-full"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-tight text-slate-500">Sem avaliações próximas</p></div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
              <h3 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-tight mb-3 md:mb-4 flex items-center gap-2"><Calendar className="text-orange-500 w-3 h-3 md:w-[14px] md:h-[14px]" /> Eventos (15d)</h3>
              <div className="space-y-2 md:space-y-3 flex-1">
                {upcomingEvents.length > 0 ? upcomingEvents.map((event, idx) => {
                  const school = data.schools.find(s => s.id === event.schoolId);
                  const color = school?.color || '#f97316';

                  return (
                    <div key={idx} onClick={onNavigateToAgenda} className="flex items-center gap-3 p-2.5 md:p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800 cursor-pointer hover:scale-[1.02] transition-transform" style={{ borderColor: color + '30', backgroundColor: color + '05' }}>
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg flex flex-col items-center justify-center shrink-0 border-b-2" style={{ backgroundColor: color + '15', color: color, borderColor: color + '30' }}>
                        <span className="text-[7px] md:text-[8px] font-black uppercase leading-none mb-0.5">{getShortWeekDay(event.date)}</span>
                        <span className="text-[10px] md:text-xs font-black leading-none">{getDayMonth(event.date)}</span>
                      </div>
                      <div className="flex-1 overflow-hidden min-w-0">
                        <h4 className="text-[9px] md:text-[10px] font-black text-slate-800 dark:text-white uppercase truncate">{event.title}</h4>
                        <div className="flex items-center gap-2 mt-0.5 min-w-0">
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter shrink-0">{EVENT_TYPE_LABELS[event.type] || event.type}</span>
                          <span className="text-[7px] font-black uppercase truncate" style={{ color: color }}>• {school?.name}</span>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-6 md:py-8 text-center flex flex-col items-center justify-center h-full"><p className="text-[8px] md:text-[9px] font-black uppercase tracking-tight text-slate-500">Sem eventos próximos</p></div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 md:space-y-6">
          {renderDashboardCalendar()}
          <div className="bg-amber-50 dark:bg-amber-900/10 p-4 md:p-6 rounded-xl border border-amber-100 dark:border-amber-900/20">
            <div onClick={onNavigateToReminders} className="flex items-center justify-between mb-3 md:mb-4 cursor-pointer group">
              <div className="flex items-center gap-2">
                <div className="p-1 md:p-1.5 bg-white dark:bg-slate-800 rounded-lg shadow-sm text-amber-500"><Bell size={12} className="md:w-[14px] md:h-[14px]" /></div>
                <h4 className="text-[9px] md:text-[10px] font-black uppercase text-amber-600 tracking-tight">Notas & Lembretes</h4>
              </div>
              <ArrowRight size={12} className="text-amber-400 group-hover:translate-x-1 transition-transform md:w-[14px] md:h-[14px]" />
            </div>

            {data.reminders.length > 0 ? (
              <div className="space-y-2">
                {data.reminders.slice(0, 3).map((reminder) => {
                  const school = data.schools.find(s => s.id === reminder.schoolId);
                  const color = school?.color || '#f59e0b'; // Amber default

                  return (
                    <div key={reminder.id} onClick={onNavigateToReminders} className="bg-white dark:bg-slate-900 p-2.5 md:p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800 cursor-pointer hover:translate-x-1 transition-transform" style={{ borderLeft: `3px solid ${color}` }}>
                      <p className="text-[9px] md:text-[10px] font-black text-slate-700 dark:text-slate-200 truncate">{reminder.title}</p>
                      <div className="flex justify-between items-center mt-0.5">
                        <p className="text-[8px] text-slate-500 font-bold truncate max-w-[60%]">{reminder.content}</p>
                        {school && <span className="text-[7px] font-black uppercase truncate max-w-[35%]" style={{ color: color }}>{school.name}</span>}
                      </div>
                    </div>
                  );
                })}
                {data.reminders.length > 3 && (
                  <p className="text-[8px] md:text-[9px] font-black text-amber-500 text-center uppercase tracking-tighter mt-2">+ {data.reminders.length - 3} outros</p>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-[8px] md:text-[9px] text-amber-700/60 font-bold uppercase">Nenhum lembrete ativo</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RODAPÉ DO DASHBOARD */}
      <div className="pt-10 pb-8 text-center opacity-60">
        <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Leciona v1.0 - Codex
        </p>
        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-1">
          Criado para professores pelo professor Cadu Michel
        </p>
        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400">
          Contato: appleciona@gmail.com
        </p>
      </div>
    </div >
  );
};

export default Dashboard;