"""Add audio field to Message model

Revision ID: 37021e92a8bd
Revises: 3abd74161206
Create Date: 2024-07-26 03:37:46.693869

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '37021e92a8bd'
down_revision = '3abd74161206'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('message', schema=None) as batch_op:
        batch_op.add_column(sa.Column('audio', sa.Text(), nullable=True))

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('message', schema=None) as batch_op:
        batch_op.drop_column('audio')

    # ### end Alembic commands ###
