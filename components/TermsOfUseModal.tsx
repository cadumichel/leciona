import React from 'react';
import { X, FileText } from 'lucide-react';

interface TermsOfUseModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const TermsOfUseModal: React.FC<TermsOfUseModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    <h2 className="text-lg font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
                        <FileText className="text-primary" size={20} />
                        Termos de Uso
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 text-sm text-slate-600 dark:text-slate-300 leading-relaxed space-y-4 custom-scrollbar">
                    <p className="font-bold text-slate-800 dark:text-white">TERMOS DE USO E POLÍTICA DE PRIVACIDADE – APP LECIONA</p>
                    <p className="text-xs text-slate-500">Última atualização: 10 de Fevereiro de 2026</p>

                    <p>
                        Bem-vindo ao Leciona. Ao baixar, acessar ou utilizar este aplicativo, você (doravante denominado "Usuário" ou "Docente") concorda com estes Termos de Uso. Caso não concorde com qualquer disposição, por favor, não utilize o aplicativo.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">1. OBJETIVO DO APLICATIVO</h3>
                    <p>
                        1.1. O Leciona é uma ferramenta de organização pessoal e gestão de rotina docente.<br />
                        1.2. O aplicativo tem como finalidade exclusiva auxiliar o professor no registro de chamadas, notas, conteúdos lecionados e planejamento de aulas.<br />
                        1.3. O Leciona não é um sistema oficial governamental ou institucional, servindo apenas como uma ferramenta de apoio/espelho para a organização individual do Docente.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">2. DADOS DOS ALUNOS E LGPD (Lei Geral de Proteção de Dados)</h3>
                    <p>
                        2.1. Para a utilização das funcionalidades do App, o Usuário insere dados pessoais de terceiros (alunos), tais como nomes, turmas, frequência e desempenho acadêmico.<br />
                        2.2. Origem dos Dados: O Usuário declara e garante que todo e qualquer dado de aluno inserido no aplicativo foi confiado a ele legitimamente pela Instituição de Ensino à qual está vinculado, para fins estritamente pedagógicos.<br />
                        2.3. Papel do Usuário: Para fins da Lei nº 13.709/2018 (LGPD), o Usuário atua como controlador ou operador dos dados inseridos, sendo inteiramente responsável pela legalidade da posse e do manuseio dessas informações.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">3. DEVERES DE CONFIDENCIALIDADE E SIGILO</h3>
                    <p>
                        3.1. Proibição de Divulgação: É estritamente vedado ao Usuário divulgar, compartilhar, publicar em redes sociais, enviar por aplicativos de mensagens (exceto canais oficiais da escola) ou tornar público qualquer dado pessoal, nota ou ocorrência disciplinar de alunos registrados no App.<br />
                        3.2. Finalidade Restrita: As informações inseridas no Leciona devem ser utilizadas exclusivamente para o cumprimento das obrigações profissionais do Docente junto à escola. Qualquer uso fora deste escopo (uso comercial, curiosidade, exposição indevida) é proibido.<br />
                        3.3. Dados de Menores: O Usuário reconhece que lida com dados de crianças e adolescentes, os quais gozam de proteção especial pelo Estatuto da Criança e do Adolescente (ECA) e pela LGPD, exigindo sigilo absoluto.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">4. SEGURANÇA E ACESSO</h3>
                    <p>
                        4.1. O Usuário é o único responsável pela segurança do dispositivo (celular/computador) onde o aplicativo está instalado.<br />
                        4.2. Recomenda-se o uso de senhas fortes, biometria e bloqueio de tela no dispositivo para evitar que terceiros não autorizados acessem os dados escolares contidos no aplicativo.<br />
                        4.3. O desenvolvedor do Leciona não se responsabiliza por vazamentos de dados decorrentes de perda, roubo, furto do dispositivo do Usuário ou compartilhamento de senhas.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">5. ARMAZENAMENTO E EXCLUSÃO DE DADOS</h3>
                    <p>
                        5.1. O Leciona opera com armazenamento local e/ou sincronização em nuvem (Firebase) vinculada à conta pessoal do Usuário.<br />
                        5.2. Ao utilizar ferramentas de exclusão (como "Deletar Turma", "Deletar Escola" ou "Sanear Banco de Dados"), o Usuário entende que os dados serão removidos permanentemente, não havendo garantia de recuperação se não houver backup prévio.<br />
                        5.3. O Usuário pode, a qualquer momento, solicitar a exclusão de sua conta e de todos os dados associados através das configurações do aplicativo.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">6. LIMITAÇÃO DE RESPONSABILIDADE</h3>
                    <p>
                        6.1. O Leciona é fornecido "como está". O desenvolvedor não se responsabiliza por eventuais erros de digitação, inconsistências lançadas pelo próprio Usuário ou falhas na sincronização de dados que resultem em discrepâncias com os sistemas oficiais das escolas.<br />
                        6.2. O desenvolvedor do App isenta-se de qualquer responsabilidade civil ou criminal decorrente do uso indevido dos dados dos alunos por parte do Usuário, incluindo vazamentos para a internet ou compartilhamento não autorizado. A responsabilidade pelo sigilo das informações inseridas é inteira e exclusiva do Docente.
                    </p>

                    <h3 className="font-bold text-slate-800 dark:text-white mt-4">7. DISPOSIÇÕES GERAIS</h3>
                    <p>
                        7.1. Estes termos podem ser alterados a qualquer momento para adequação legal ou evolução do aplicativo. O uso contínuo do serviço após as alterações implica aceitação tácita.<br />
                        7.2. Fica eleito o foro da Comarca de Brusque/SC para dirimir quaisquer dúvidas oriundas destes Termos.
                    </p>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold uppercase text-xs tracking-tight hover:opacity-90 transition-opacity"
                    >
                        Entendi
                    </button>
                </div>

            </div>
        </div>
    );
};

export default TermsOfUseModal;
