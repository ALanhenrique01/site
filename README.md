# ANA CAROLINA BEAUTY • Sistema de Agendamento para Designer de Sobrancelhas ✨

Sistema completo, moderno e responsivo desenvolvido para estúdios e designers de sobrancelhas com gestão completa para **Supervisora (Profissional)** e **Clientes**.

---

## 🌟 Funcionalidades Implementadas

### 👑 Painel da Supervisora (Profissional / Admin)
- **Gestão de Horários Disponíveis**:
  - Selecionar uma data específica e escolher horários de atendimento (botões rápidos com grade das 08h às 19h ou horário personalizado).
  - **Gerador em lote**: define períodos (ex: segunda a sábado) com horários pré-configurados com 1 clique.
  - Grade visual que mostra os horários livres (🟢 Vago) e os horários já reservados (🔒 Reservado).
  - Remoção de horários vagos que não deseja mais atender.
- **Gestão e Confirmação de Agendamentos**:
  - Visualização de todos os agendamentos com filtros dinâmicos por status (Pendentes, Confirmados, Concluídos, Cancelados) e por data.
  - Visualização completa: nome da cliente, telefone/WhatsApp com link direto (`wa.me`), serviço escolhido, valor, data e hora.
  - **Destaque especial para a observação da cliente** (alergias, preferências de formato, pedidos especiais).
  - **Botão de Confirmação**: confirma o agendamento com 1 clique (status atualizado para "Confirmado").
  - Botões para concluir atendimento ou cancelar.
- **Indicadores / Dashboard**:
  - Contagem em tempo real de agendamentos pendentes para aprovação, confirmados e total.

---

### 🌸 Área da Cliente
- **Cadastro Simples**: Nome completo, e-mail/usuário, telefone/WhatsApp e senha simples (mínimo 4 caracteres).
- **Login Rápido**: Acesso seguro com sessão local.
- **Fluxo de Agendamento Inteligente**:
  1. **Escolha do Procedimento**: Design Personalizado, Design com Henna, Brow Lamination, Nanoblading, Spa de Sobrancelhas, etc.
  2. **Escolha da Data**: Calendário interativo.
  3. **Seleção de Horários Vagos**: O sistema busca dinamicamente **somente os horários disponibilizados pela supervisora que ainda não foram reservados**.
  4. **Campo de Observação da Cliente**: Campo aberto para informar alergias, tipo de pele, preferências de tom de henna, etc.
  5. **Resumo & Confirmação**: Resumo instantâneo do valor, duração e dados do agendamento.
- **Área "Meus Agendamentos"**:
  - Histórico de todos os agendamentos com badges visuais de status (🟡 Pendente, 🟢 Confirmado, ⚪ Concluído, 🔴 Cancelado).
  - Exibição da observação informada.
  - Botão com link direto para falar com o estúdio via WhatsApp.
  - Opção para a cliente cancelar o agendamento se necessário.

---

## 🚀 Produção

1. `pip install -r requirements.txt`
2. Defina as variáveis de ambiente (veja abaixo) e execute `start.bat` (Windows) ou `python server.py`.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` / `HOST` | `8000` / `0.0.0.0` | Porta e interface do servidor |
| `DB_FILE` | `database.db` ao lado do `server.py` | Caminho do banco SQLite (faça backup regularmente) |
| `SESSION_DAYS` | `30` | Validade do login |

Coloque o servidor atrás de um proxy HTTPS (Nginx, Caddy, IIS) para uso na internet.