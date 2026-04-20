from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db import Position, get_db
from backend.services import robinhood, schwab

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("")
async def list_positions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Position).order_by(Position.symbol))
    return [
        {
            "id": p.id,
            "symbol": p.symbol,
            "quantity": p.quantity,
            "avg_cost": p.avg_cost,
            "option_type": p.option_type,
            "strike": p.strike,
            "expiry": p.expiry,
            "source": p.source,
        }
        for p in result.scalars()
    ]


@router.post("/sync/schwab")
async def sync_schwab(db: AsyncSession = Depends(get_db)):
    try:
        raw = await schwab.get_account_positions()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    synced = 0
    for item in raw:
        instrument = item.get("instrument", {})
        symbol = instrument.get("symbol", "")
        if not symbol:
            continue
        long_qty = float(item.get("longQuantity", 0))
        short_qty = float(item.get("shortQuantity", 0))
        qty = long_qty - short_qty
        avg_price = float(item.get("averagePrice", 0))
        asset_type = instrument.get("assetType", "EQUITY")

        pos = Position(
            symbol=symbol,
            quantity=qty,
            avg_cost=avg_price,
            option_type=instrument.get("putCall", "").lower() or None,
            strike=float(instrument.get("strikePrice", 0)) or None,
            expiry=instrument.get("expirationDate", "") or None,
            source="schwab",
        )
        db.add(pos)
        synced += 1

    await db.commit()
    return {"synced": synced}


@router.post("/sync/robinhood")
async def sync_robinhood(db: AsyncSession = Depends(get_db)):
    try:
        equity = robinhood.get_positions()
        options = robinhood.get_option_positions()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    for item in equity + options:
        pos = Position(**item)
        db.add(pos)

    await db.commit()
    return {"synced": len(equity) + len(options)}


@router.delete("/{position_id}")
async def delete_position(position_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Position).where(Position.id == position_id))
    pos = result.scalar_one_or_none()
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found.")
    await db.delete(pos)
    await db.commit()
    return {"deleted": position_id}
