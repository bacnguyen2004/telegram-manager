"""Static name/bio pools for auto-profile generation (no I/O)."""

GLOBAL_FIRST = [
    "Alex", "Aiden", "Aaron", "Adam", "Adrian", "Alan", "Andrew", "Anthony",
    "Ben", "Blake", "Brian", "Caleb", "Carter", "Chris", "Daniel", "David",
    "Dylan", "Ethan", "Felix", "Finn", "Henry", "Ian", "Jack", "James",
    "Jason", "Kai", "Kevin", "Leo", "Liam", "Logan", "Lucas", "Luke",
    "Mason", "Max", "Nathan", "Noah", "Oliver", "Owen", "Ryan", "Sam",
    "Theo", "Victor", "William", "Anna", "Ava", "Bella", "Chloe", "Ella",
    "Emma", "Grace", "Iris", "Ivy", "Julia", "Kate", "Lily", "Luna",
    "Maya", "Mia", "Nina", "Nora", "Ruby", "Sara", "Sofia", "Zoe",
]

GLOBAL_LAST = [
    "Adams", "Allen", "Baker", "Bell", "Brooks", "Brown", "Carter", "Clark",
    "Cole", "Cooper", "Davis", "Evans", "Fisher", "Ford", "Gray", "Green",
    "Hall", "Hayes", "Hill", "Hunter", "James", "King", "Lane", "Lewis",
    "Miller", "Morgan", "Parker", "Reed", "Scott", "Stone", "Taylor",
    "Turner", "Walker", "Ward", "Wells", "White", "Young",
]

NAME_TOKENS = [
    "nova", "pixel", "orbit", "wave", "mint", "stone", "river", "cloud",
    "signal", "alpha", "luna", "sol", "zen", "kai", "rex", "nix",
]

VN_HO = [
    "Nguyen", "Tran", "Le", "Pham", "Hoang", "Huynh", "Phan", "Vu", "Vo",
    "Dang", "Bui", "Do", "Ho", "Ngo", "Duong", "Ly", "Truong", "Dinh", "Mai",
]

VN_TEN = [
    "An", "Anh", "Bao", "Binh", "Chau", "Chi", "Cuong", "Dat", "Duc", "Duy",
    "Giang", "Ha", "Hai", "Han", "Hieu", "Hoa", "Hoang", "Huy", "Khanh",
    "Khoa", "Lam", "Lan", "Linh", "Long", "Mai", "Minh", "Nam", "Ngoc",
    "Nhi", "Phong", "Phuc", "Phuong", "Quang", "Quan", "Son", "Tam", "Thao",
    "Thanh", "Thien", "Thu", "Trang", "Tri", "Trung", "Tu", "Tuan", "Tung",
    "Uyen", "Van", "Viet", "Vy", "Yen",
]

VN_DEM = [
    "Minh", "Gia", "Hoang", "Thanh", "Bao", "Khanh", "Ngoc", "Quang", "Tuan",
    "Anh", "Duc", "Huu", "Nhat", "Phuc", "Thien", "Trong", "Xuan", "Hong",
]

COMMON_WORDS = [
    "daily", "notes", "space", "cloud", "market", "coffee", "nova", "pixel",
    "signal", "orbit", "wave", "mint", "green", "blue", "light", "city",
    "quiet", "alpha", "stone", "river", "page", "loop", "soft", "simple",
    "mood", "flow", "star", "moon", "rain", "wind", "music", "book",
]

BIO_SHORT = [
    "online", "just reading", "coffee and notes", "quiet mode", "random updates",
    "daily thoughts", "nothing special", "learning everyday", "mostly here",
    "watching quietly", "small notes", "still around", "reading only", "slow days",
]

BIO_TEMPLATES = [
    "{object} and {mood}",
    "mostly {activity}",
    "{city} notes",
    "watching {object} quietly",
    "just {mood}",
    "{object}, {activity}",
    "a bit of {object}",
    "{city} / {object}",
    "quietly {activity}",
]

BIO_OBJECTS = [
    "coffee", "notes", "music", "books", "clouds", "cities", "markets",
    "updates", "signals", "pages", "small ideas", "daily stuff",
]

BIO_MOODS = [
    "quiet days", "random thoughts", "slow mornings", "late nights",
    "simple things", "soft mood", "low energy", "clear head", "calm notes",
]

BIO_ACTIVITIES = [
    "reading", "watching", "scrolling", "learning", "taking notes",
    "waiting", "thinking", "working quietly", "checking updates",
]

BIO_CITIES = [
    "saigon", "hanoi", "danang", "tokyo", "seoul", "singapore", "bangkok",
    "city", "home", "somewhere",
]

DICEBEAR_STYLES = [
    "adventurer", "avataaars", "big-smile", "bottts", "croodles",
    "fun-emoji", "lorelei", "micah", "miniavs", "notionists", "pixel-art",
]
