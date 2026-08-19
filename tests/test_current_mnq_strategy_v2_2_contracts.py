from datetime import date
import pytest
from research import current_mnq_strategy_v2_2_contracts as c


def test_cme_2026_roll_dates():
    assert c.cme_equity_roll_date(2026,3)==date(2026,3,16)
    assert c.cme_equity_roll_date(2026,6)==date(2026,6,15)
    assert c.cme_equity_roll_date(2026,9)==date(2026,9,14)
    assert c.cme_equity_roll_date(2026,12)==date(2026,12,14)


def test_expected_lead_contract_switches_on_roll_monday():
    assert c.mnq_contract_code(date(2026,3,13))=='MNQH26'
    assert c.mnq_contract_code(date(2026,3,16))=='MNQM26'
    assert c.mnq_contract_code(date(2026,6,12))=='MNQM26'
    assert c.mnq_contract_code(date(2026,6,15))=='MNQU26'
    assert c.mnq_contract_code(date(2026,12,14))=='MNQH27'


def test_projectx_contract_ids_are_explicit():
    assert c.projectx_contract_id(date(2026,3,13))=='CON.F.US.MNQ.H26'
    assert c.projectx_contract_id(date(2026,3,16))=='CON.F.US.MNQ.M26'


def test_contract_audit_refuses_wrong_series():
    rows=[c.ContractBarSource(date(2026,3,13),'CON.F.US.MNQ.H26','CON.F.US.MNQ.M26','generic.csv')]
    assert c.audit_contract_sources(rows)['status']=='REFUSE'
    with pytest.raises(RuntimeError,match='CONTRACT_PROVENANCE_REFUSE'):
        c.require_contract_sources(rows)


def test_contract_audit_passes_exact_contract():
    rows=[c.ContractBarSource(date(2026,3,23),'CON.F.US.MNQ.M26','CON.F.US.MNQ.M26','MNQM26.csv')]
    assert c.audit_contract_sources(rows)['status']=='PASS'
