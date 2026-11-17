import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, AlertTriangle, Send, Smartphone } from 'lucide-react';
import Toggle from './Toggle';
import { AppData } from '../types';
import { RESUMO_PADRAO } from '../utils/avisos';
import { SituacaoDosAvisos, ativarAvisos, desativarAvisos, situacaoDosAvisos, testarAvisos } from '../utils/avisosAparelho';
import { notifyError, notifySuccess, notifyWarning } from '../utils/dialogs';

interface AvisosSettingsProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  /** Conta Google conectada (os avisos são enviados pelo servidor para a conta do professor) */
  conectado: boolean;
}

const quando = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = d.toDateString() === new Date().toDateString();
  return `${hoje ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** O agendador chama a cada 5 minutos: mais de 20 minutos sem chamar é sinal de problema. */
const agendadorParado = (iso?: string | null) => !iso || Date.now() - new Date(iso).getTime() > 20 * 60000;

/**
 * Ajustes → Avisos: liga as notificações neste aparelho e escolhe quais avisos receber.
 * Quem envia é o servidor (connector/avisosPush.ts), por isso chegam com o app fechado.
 */
const AvisosSettings: React.FC<AvisosSettingsProps> = ({ data, onUpdateData, conectado }) => {
  const [situacao, setSituacao] = useState<SituacaoDosAvisos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const settings = data.settings;
  const mudar = (campos: Partial<AppData['settings']>) => onUpdateData({ settings: { ...settings, ...campos } });

  useEffect(() => {
    let vivo = true;
    if (!conectado) { setSituacao(null); return; }
    void situacaoDosAvisos().then(s => { if (vivo) setSituacao(s); });
    return () => { vivo = false; };
  }, [conectado]);

  const executar = async (acao: () => Promise<SituacaoDosAvisos>) => {
    setOcupado(true);
    try {
      const s = await acao();
      setSituacao(s);
      if (s.erro) notifyError(s.erro);
      else if (s.permissao === 'denied') notifyWarning('As notificações do Leciona estão bloqueadas neste aparelho. Libere nas configurações do navegador (ou do app instalado) e tente de novo.');
      return s;
    } finally {
      setOcupado(false);
    }
  };

  const testar = async () => {
    setOcupado(true);
    try {
      const r = await testarAvisos();
      if (r.erro) notifyError(r.erro);
      else if (r.entregues === 0) notifyWarning('O servidor não conseguiu entregar o aviso de teste. Desative e ative os avisos neste aparelho e tente de novo.');
      else notifySuccess(`Aviso de teste enviado para ${r.entregues} aparelho(s). Ele deve aparecer em alguns segundos.`);
    } finally {
      setOcupado(false);
    }
  };

  const ativo = !!situacao?.ativo;
  const caixa = 'p-3 rounded-lg border text-xs font-medium leading-relaxed';
  const botao = 'px-3 py-2 rounded-lg font-black uppercase text-[10px] tracking-tight flex items-center justify-center gap-1.5 disabled:opacity-50';

  return (
    <>
      <div className="mb-4">
        <h3 className="text-[13px] font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-1"><Bell className="text-amber-500" size={18} /> Avisos</h3>
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 leading-relaxed max-w-lg">
          Notificações de aula sem registro e de lembretes. Chegam mesmo com o app fechado, em cada aparelho em que você ativar.
        </p>
      </div>

      {/* Este aparelho */}
      <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${ativo ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200'}`}>
              {ativo ? <BellRing size={16} /> : <Smartphone size={16} />}
            </div>
            <div>
              <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Neste aparelho</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {!conectado ? 'Conecte sua conta Google para ativar os avisos.'
                  : !situacao ? 'Conferindo…'
                  : !situacao.suportado ? 'Este navegador não recebe notificações com o app fechado. No celular, instale o Leciona na tela inicial.'
                  : ativo ? 'Avisos ativados.'
                  : situacao.permissao === 'denied' ? 'As notificações estão bloqueadas. Libere nas configurações do navegador.'
                  : 'Avisos desativados.'}
              </p>
            </div>
          </div>
          {conectado && situacao?.suportado && (
            <div className="flex gap-2 shrink-0">
              {ativo && (
                <button onClick={testar} disabled={ocupado} className={`${botao} bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200`}>
                  <Send size={12} /> Enviar teste
                </button>
              )}
              <button
                onClick={() => executar(ativo ? desativarAvisos : ativarAvisos)}
                disabled={ocupado}
                className={`${botao} ${ativo ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200' : 'bg-primary text-white'}`}
              >
                {ativo ? 'Desativar' : 'Ativar avisos'}
              </button>
            </div>
          )}
        </div>

        {conectado && situacao && !situacao.erro && situacao.agendadorConfigurado === false && (
          <div className={`${caixa} mt-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 flex gap-2`}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Falta concluir a configuração do servidor (agendador). Até lá, os avisos só aparecem com o app aberto. Você já pode ativar neste aparelho e usar "Enviar teste".</span>
          </div>
        )}
        {conectado && situacao && !situacao.erro && situacao.agendadorConfigurado && (
          agendadorParado(situacao.ultimaConferencia) ? (
            <div className={`${caixa} mt-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 flex gap-2`}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {situacao.ultimaConferencia
                  ? `O servidor conferiu os avisos pela última vez ${quando(situacao.ultimaConferencia)}. Ele deveria conferir a cada 5 minutos: veja se o agendador (cron-job.org) está ligado.`
                  : 'O servidor ainda não conferiu os avisos nenhuma vez: veja se o agendador (cron-job.org) está ligado.'}
              </span>
            </div>
          ) : (
            <p className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-green-600 shrink-0" />
              <span>
                Servidor conferindo a cada 5 minutos (última vez {quando(situacao.ultimaConferencia)}).
                {situacao.ultimoEnvio ? ` Último aviso enviado ${quando(situacao.ultimoEnvio.quando)}.` : ''}
              </span>
            </p>
          )
        )}
        {conectado && situacao?.aparelhos && situacao.aparelhos.length > 0 && (
          <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Aparelhos com avisos ativados: {situacao.aparelhos.map(a => `${a.nome}${a.este ? ' (este)' : ''}`).join(', ')}.
          </p>
        )}
      </div>

      {/* Quais avisos */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className={`flex flex-col gap-2 p-4 rounded-lg border transition-all cursor-pointer ${settings.alertAfterShift ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 border-transparent opacity-70'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase dark:text-white">Fim de turno</span>
            <Toggle checked={!!settings.alertAfterShift} onChange={e => mudar({ alertAfterShift: e.target.checked })} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Quando o seu último horário do turno termina e ficou aula sem registro.</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-400">Avisar</span>
            <select value={settings.alertAfterShiftDelay || 0} onChange={e => mudar({ alertAfterShiftDelay: parseInt(e.target.value) })} className="bg-white dark:bg-slate-700 border-none text-[10px] font-black text-amber-600 px-2 py-1 rounded-lg outline-none">
              <option value="0">Ao terminar</option>
              <option value="1">1 min depois</option>
              <option value="5">5 min depois</option>
              <option value="10">10 min depois</option>
              <option value="30">30 min depois</option>
            </select>
          </div>
        </label>

        <label className={`flex flex-col gap-2 p-4 rounded-lg border transition-all cursor-pointer ${settings.alertDailySummary ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 border-transparent opacity-70'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase dark:text-white">Resumo do dia</span>
            <Toggle checked={!!settings.alertDailySummary} onChange={e => mudar({ alertDailySummary: e.target.checked })} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Em um horário fixo, só se ainda houver aula de hoje sem registro.</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-400">Às</span>
            <input
              type="time"
              value={settings.alertDailySummaryTime || RESUMO_PADRAO}
              onChange={e => mudar({ alertDailySummaryTime: e.target.value || RESUMO_PADRAO })}
              className="bg-white dark:bg-slate-700 border-none text-[11px] font-black text-amber-600 px-2 py-1 rounded-lg outline-none"
            />
          </div>
        </label>
      </div>

      <p className="mt-3 text-[11px] font-medium text-slate-400 dark:text-slate-500 leading-relaxed">
        Lembretes com alarme também chegam como notificação. Não há aviso em feriado, recesso, aula cancelada por evento ou marcada como "Não houve aula".
        O aviso pode atrasar até uns 5 minutos. Som e vibração são escolhidos nas configurações de notificação do próprio aparelho.
        Num aparelho sem avisos ativados, o aviso aparece na tela enquanto o app estiver aberto.
      </p>
    </>
  );
};

export default AvisosSettings;
