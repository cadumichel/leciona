import { describe, it, expect } from 'vitest';
import { findOrphanLogs } from '../components/MaintenanceSection';

// Dados inventados
const data: any = {
  schools: [{ id: 'E', name: 'Escola Teste', classes: [{ id: 'c6', name: '6º Ano' }] }],
  students: [{ id: 'p1', name: 'Particular' }],
  logs: [
    { id: 'l1', schoolId: 'E', classId: 'c6' },
    { id: 'l2', schoolId: 'E', classId: 'turma-excluida' }, // turma excluída: histórico, fica
    { id: 'l3', schoolId: 'escola-apagada', classId: 'x' },
    { id: 'l4', studentId: 'p1' },
    { id: 'l5', studentId: 'aluno-apagado' },
    { id: 'l6' }
  ]
};

describe('manutenção: registros órfãos', () => {
  it('só aponta aulas de escola ou aluno particular que não existe mais', () => {
    expect(findOrphanLogs(data).map(l => l.id)).toEqual(['l3', 'l5']);
  });
});
