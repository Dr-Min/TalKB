import os
import base64
from io import BytesIO
import secrets
import click
from datetime import datetime, timedelta
from flask import Flask, send_file, render_template, request, jsonify, session, url_for, redirect, abort
from flask_migrate import Migrate
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, current_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from openai import OpenAI
from dotenv import load_dotenv
from sqlalchemy import desc, func
from flask_mail import Mail, Message as FlaskMessage
from flask_admin import Admin, AdminIndexView, expose, BaseView
from flask_admin.contrib.sqla import ModelView
from flask_admin.form import SecureForm
from flask.cli import with_appcontext
from pytz import timezone

# Flask 애플리케이션 초기화
app = Flask(__name__)
CORS(app)

# 한국 시간대 설정
KST = timezone('Asia/Seoul')

# 애플리케이션 설정
app.config['SECRET_KEY'] = os.urandom(24)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# 환경 변수 로드 및 OpenAI 클라이언트 초기화
load_dotenv()
client = OpenAI()
migrate = Migrate(app, db)

# Flask-Mail 설정
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USE_SSL'] = False
app.config['MAIL_USERNAME'] = 'your_email@gmail.com'  # 실제 이메일 주소로 변경
app.config['MAIL_PASSWORD'] = 'your_app_password'  # 실제 앱 비밀번호로 변경
app.config['MAIL_DEFAULT_SENDER'] = 'your_email@gmail.com'  # 실제 이메일 주소로 변경

mail = Mail(app)

# 사용자 모델 정의
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    total_usage_time = db.Column(db.Integer, default=0)
    conversations = db.relationship('Conversation', backref='user', lazy=True)
    reset_token = db.Column(db.String(100), unique=True)
    reset_token_expiration = db.Column(db.DateTime)
    is_admin = db.Column(db.Boolean, default=False)
    reports = db.relationship('Report', backref='user', lazy=True)
    messages = db.relationship('Message', backref='user', lazy=True)

    def set_reset_token(self):
        self.reset_token = secrets.token_urlsafe(32)
        self.reset_token_expiration = datetime.utcnow() + timedelta(hours=1)
        db.session.commit()

    def check_reset_token(self, token):
        return (self.reset_token == token and
                self.reset_token_expiration > datetime.utcnow())

# 대화 모델 정의
class Conversation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    end_time = db.Column(db.DateTime)
    messages = db.relationship('Message', backref='conversation', lazy=True, order_by="Message.timestamp")

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('conversation.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    is_user = db.Column(db.Boolean, nullable=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(KST))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    responded = db.Column(db.Boolean, default=False)
    audio = db.Column(db.Text)  # 새로운 audio 필드 추가

# 보고서 모델 정의
class Report(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    report_number = db.Column(db.Integer, nullable=False)

    @classmethod
    def get_next_report_number(cls, user_id):
        last_report = cls.query.filter_by(user_id=user_id).order_by(cls.report_number.desc()).first()
        return (last_report.report_number + 1) if last_report else 1

# 관리자 뷰 보안 설정
class SecureModelView(ModelView):
    form_base_class = SecureForm
    def is_accessible(self):
        return current_user.is_authenticated and current_user.is_admin

# 관리자 인덱스 뷰 설정
class MyAdminIndexView(AdminIndexView):
    @expose('/')
    def index(self):
        if not current_user.is_authenticated or not current_user.is_admin:
            return redirect(url_for('login', next=request.url))
        return super(MyAdminIndexView, self).index()

# 음성 변환 함수
def text_to_speech(text):
    response = client.audio.speech.create(
        model="tts-1-hd",
        voice="nova",
        speed=0.8,
        input=text
    )

    audio_bytes = BytesIO()
    for chunk in response.iter_bytes():
        audio_bytes.write(chunk)
    audio_bytes.seek(0)

    audio_base64 = base64.b64encode(audio_bytes.read()).decode('utf-8')
    return audio_base64

# @app.route('/admin/chat/<int:user_id>')
# @login_required
# def admin_chat(user_id):
#     if not current_user.is_admin:
#         abort(403)
#     user = User.query.get_or_404(user_id)
#     messages = Message.query.filter_by(user_id=user_id).order_by(Message.timestamp).all()
#     return jsonify([{
#         'content': msg.content,
#         'is_user': msg.is_user,
#         'timestamp': msg.timestamp.isoformat()
#     } for msg in messages])

class UserConversationsView(BaseView):
    @expose('/')
    def index(self):
        if not (current_user.is_authenticated and current_user.is_admin):
            abort(403)
        users = User.query.all()
        return self.render('admin/user_conversations.html', users=users)

# 관리자 페이지 설정
admin = Admin(app, name='TalKR Admin', template_mode='bootstrap3', index_view=MyAdminIndexView())
admin.add_view(SecureModelView(User, db.session))
admin.add_view(SecureModelView(Conversation, db.session))
admin.add_view(SecureModelView(Message, db.session))
admin.add_view(UserConversationsView(name='User Conversations', endpoint='user_conversations'))

@app.route('/admin/get_conversation_dates/<int:user_id>')
@login_required
def get_conversation_dates(user_id):
    if not current_user.is_admin:
        abort(403)

    dates = db.session.query(func.date(Message.timestamp)).filter(
        Message.user_id == user_id
    ).distinct().order_by(func.date(Message.timestamp).desc()).all()

    return jsonify([date[0].isoformat() for date in dates])

@app.route('/admin/get_conversation_by_date/<int:user_id>/<string:date>')
@login_required
def get_conversation_by_date(user_id, date):
    if not current_user.is_admin:
        abort(403)

    try:
        target_date = datetime.strptime(date, '%Y-%m-%d').date()
    except ValueError:
        abort(400)  # Bad request if date format is invalid

    messages = Message.query.filter(
        Message.user_id == user_id,
        func.date(Message.timestamp) == target_date
    ).order_by(Message.timestamp).all()

    return jsonify([
        {
            'content': msg.content,
            'is_user': msg.is_user,
            'timestamp': msg.timestamp.isoformat()
        } for msg in messages
    ])

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password, data['password']):
        login_user(user, remember=True)
        return jsonify({"success": True, "username": user.username, "userId": user.id})
    return jsonify({"success": False})

@app.route('/check_login', methods=['GET'])
def check_login():
    if current_user.is_authenticated:
        return jsonify({"logged_in": True, "username": current_user.username})
    return jsonify({"logged_in": False})

@app.route('/logout', methods=['GET', 'POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"success": True})

@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    username = data['username']
    email = data['email']
    password = data['password']

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({"success": False, "error": "email_taken"})

    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({"success": False, "error": "username_taken"})

    hashed_password = generate_password_hash(password)
    new_user = User(username=username, email=email, password=hashed_password)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"success": True, "message": "User created successfully"})

@app.route('/chat', methods=['POST'])
@login_required
def chat():
    user_message_content = request.json['message']
    temp_id = request.json.get('tempId')

    try:
        active_conversation = Conversation.query.filter_by(user_id=current_user.id, end_time=None).first()
        if not active_conversation:
            active_conversation = Conversation(user_id=current_user.id)
            db.session.add(active_conversation)
            db.session.commit()

        user_message = Message(conversation_id=active_conversation.id, content=user_message_content, is_user=True, user_id=current_user.id)
        db.session.add(user_message)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': 'Message received and stored successfully.',
            'messageId': user_message.id
        })
    except Exception as e:
        db.session.rollback()
        print(f"Error in chat processing: {str(e)}")
        return jsonify({'message': 'Sorry, an error occurred.', 'success': False}), 500

@app.route('/admin/send_response', methods=['POST'])
@login_required
def send_admin_response():
    if not current_user.is_admin:
        return jsonify({"error": "Unauthorized access"}), 403

    data = request.json
    user_id = data.get('user_id')
    response_content = data.get('response')

    if not user_id or not response_content:
        return jsonify({"error": "Missing user ID or response content"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    active_conversation = Conversation.query.filter_by(user_id=user.id, end_time=None).first()
    if not active_conversation:
        active_conversation = Conversation(user_id=user.id)
        db.session.add(active_conversation)
        db.session.commit()

    # TTS 생성
    audio_base64 = text_to_speech(response_content)

    admin_response = Message(
        conversation_id=active_conversation.id,
        content=response_content,
        is_user=False,
        user_id=user.id,
        audio=audio_base64,
        timestamp=datetime.now(KST)
    )
    db.session.add(admin_response)
    db.session.commit()

    print(f"Admin response sent: {admin_response.id}")  # 로깅 추가

    return jsonify({
        "success": True,
        "message": "Response sent successfully",
        "response": {
            'id': admin_response.id,
            'content': admin_response.content,
            'is_user': admin_response.is_user,
            'timestamp': admin_response.timestamp.timestamp(),
            'audio': admin_response.audio
        }
    })

@app.route('/check_new_messages', methods=['GET'])
@login_required
def check_new_messages():
    last_checked = request.args.get('last_checked', type=float)
    if last_checked:
        last_checked = datetime.fromtimestamp(last_checked, tz=KST)
    else:
        last_checked = datetime.min.replace(tzinfo=KST)

    user_id = request.args.get('user_id', type=int)
    if current_user.is_admin and user_id:
        # 관리자가 특정 사용자의 메시지를 조회하는 경우
        new_messages = Message.query.filter(
            Message.user_id == user_id,
            Message.timestamp > last_checked
        ).order_by(Message.timestamp).all()
    else:
        # 일반 사용자 또는 관리자가 자신의 메시지를 조회하는 경우
        new_messages = Message.query.filter(
            Message.user_id == current_user.id,
            Message.timestamp > last_checked
        ).order_by(Message.timestamp).all()

    return jsonify({
        'new_messages': bool(new_messages),
        'messages': [{
            'id': msg.id,
            'content': msg.content,
            'is_user': msg.is_user,
            'timestamp': msg.timestamp.timestamp(),
            'audio': msg.audio
        } for msg in new_messages],
        'server_time': datetime.now(KST).timestamp()
    })

# 기존 admin_chat 라우트 제거 (사용하지 않음)
# @app.route('/admin/chat/<int:user_id>')
# @login_required
# def admin_chat(user_id):
#     ...

@app.route('/update_usage_time', methods=['POST'])
@login_required
def update_usage_time():
    data = request.json
    current_user.total_usage_time += data['time']
    db.session.commit()
    return jsonify({"success": True})

@app.route('/translate', methods=['POST'])
@login_required
def translate():
    text = request.json['text']
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a translator. Translate the given Korean text to English."},
                {"role": "user", "content": f"Translate this to English: {text}"}
            ]
        )
        translation = response.choices[0].message.content
        return jsonify({'translation': translation})
    except Exception as e:
        print(f"Translation error: {str(e)}")
        return jsonify({'error': 'Translation failed'}), 500

@app.route('/get_history', methods=['GET'])
@login_required
def get_history():
    date = request.args.get('date')

    query = Conversation.query.filter_by(user_id=current_user.id)
    if date:
        query = query.filter(Conversation.start_time < datetime.strptime(date, '%Y-%m-%d'))

    conversations = query.order_by(desc(Conversation.start_time)).limit(10).all()

    history = []
    for conv in conversations:
        messages = sorted(conv.messages, key=lambda m: m.timestamp)
        history.append({
            'date': conv.start_time.strftime('%Y-%m-%d'),
            'messages': [{'content': msg.content, 'is_user': msg.is_user, 'timestamp': msg.timestamp.strftime('%H:%M')} for msg in messages]
        })

    return jsonify({'history': history})

@app.route('/request_reset', methods=['POST'])
def request_reset():
    try:
        email = request.json.get('email')
        user = User.query.filter_by(email=email).first()
        if user:
            user.set_reset_token()
            send_password_reset_email(user)
            return jsonify({"message": "Reset link sent to your email"})
        return jsonify({"message": "Email not found"}), 404
    except Exception as e:
        print(f"Error in request_reset: {str(e)}")
        return jsonify({"message": "An error occurred"}), 500

@app.route('/reset_password/<token>', methods=['GET'])
def reset_password_form(token):
    user = User.query.filter_by(reset_token=token).first()
    if user and user.check_reset_token(token):
        return render_template('reset_password.html', token=token)
    return "Invalid or expired token", 400

@app.route('/reset_password', methods=['POST'])
def reset_password():
    token = request.json.get('token')
    new_password = request.json.get('new_password')
    user = User.query.filter_by(reset_token=token).first()
    if user and user.check_reset_token(token):
        user.password = generate_password_hash(new_password)
        user.reset_token = None
        user.reset_token_expiration = None
        db.session.commit()
        return jsonify({"message": "Password reset successful"})
    return jsonify({"message": "Invalid or expired token"}), 400

@app.route('/admin/backup_db')
@login_required
def backup_db():
    if not current_user.is_admin:
        return jsonify({"error": "Unauthorized access"}), 403

    try:
        db_path = os.path.join(app.instance_path, 'users.db')

        if not os.path.exists(db_path):
            return jsonify({"error": "Database file not found"}), 404

        return send_file(db_path, as_attachment=True, download_name='users.db')
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@click.command('create-admin')
@with_appcontext
def create_admin_command():
    username = click.prompt('Enter admin username', type=str)
    email = click.prompt('Enter admin email', type=str)
    password = click.prompt('Enter admin password', type=str, hide_input=True, confirmation_prompt=True)

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        if click.confirm('User with this email already exists. Do you want to make this user an admin?'):
            existing_user.is_admin = True
            db.session.commit()
            click.echo('User updated to admin successfully')
        else:
            click.echo('Admin user creation cancelled')
    else:
        admin_user = User(username=username, email=email, password=generate_password_hash(password), is_admin=True)
        db.session.add(admin_user)
        db.session.commit()
        click.echo('Admin user created successfully')

app.cli.add_command(create_admin_command)

@app.route('/admin/pending_messages', methods=['GET'])
@login_required
def get_pending_messages():
    if not current_user.is_admin:
        return jsonify({"error": "Unauthorized access"}), 403

    pending_messages = Message.query.filter_by(is_user=True, responded=False).order_by(Message.timestamp.asc()).all()

    return jsonify({
        "messages": [{
            "id": msg.id,
            "content": msg.content,
            "user_id": msg.user_id,
            "timestamp": msg.timestamp.isoformat()
        } for msg in pending_messages]
    })

def send_password_reset_email(user):
    token = user.reset_token
    msg = FlaskMessage(subject='Password Reset Request',
                       recipients=[user.email],
                       body=f'''To reset your password, visit the following link:
{url_for('reset_password_form', token=token, _external=True)}
If you did not make this request then simply ignore this email and no changes will be made.
''')
    mail.send(msg)

if __name__ == '__main__':
    app.run(debug=True)
