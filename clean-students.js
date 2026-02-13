// Cole este código no Console do navegador (F12 → Console) e aperte Enter

// Backup dos dados atuais (caso precise)
const backup = localStorage.getItem('leciona-app-data');
console.log('Backup dos dados:', backup);

// Carrega os dados
const data = JSON.parse(localStorage.getItem('leciona-app-data') || '{}');

// Remove TODOS os alunos (limpa dados corrompidos)
data.students = [];

// Salva de volta
localStorage.setItem('leciona-app-data', JSON.stringify(data));

// Recarrega a página
window.location.reload();

console.log('✅ Dados dos alunos limpos! Agora você pode cadastrar novos alunos sem problemas.');
